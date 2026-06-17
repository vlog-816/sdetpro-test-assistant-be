import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import JiraService from "../services/jiraService.js";
import OpenAIService from "../services/openAiService.js";
import { logger } from "../utils/logger.js";
import { extractProject, findOrCreateProject } from '../utils/projectUtils.js'
import Generation from "../models/Generation.js";


const router = Router();
let jiraService = null;
let openAIService = null;

//initializa function Jira Service
export function getJiraService() {
    if (!jiraService) {
        try {
            jiraService = new JiraService();

        } catch (error) {
            throw new Error(error.message);
        }
    }
    return jiraService;
}

export function getOpenAIService() {
    try {
        if (!openAIService) {
            openAIService = new OpenAIService();
        }
    } catch (err) {
        throw new Error(err.message)
    }
    return openAIService
}

router.get('/', async (req, res, next) => {

    try {
        //Pagination params

        const page = Math.max(1, parseInt(req.query.page || "1", 10));
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "10", 10)));
        const skip = (page - 1) * limit;

        const filterType = req.query.filter;
        let filter = {};

        if (filterType === 'mine') {
            filter = { email: req.user.email };

        } else if (filterType === 'published') {
            filter = { published: true, status: 'completed' }
        }
        else {
            //Filter: user's own or published and completed
            filter = {
                $or: [
                    { email: req.user.email },
                    { published: true, status: 'completed' }
                ]
            }
        }


        //Fetch generations with pagination
        const [gen, total] = await Promise.all([

            Generation.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
            Generation.countDocuments(filter)
        ])

        //Calculate total pages

        const pages = Math.ceil(total / limit)

        return res.status(200).json({
            success: true,
            data: gen,
            pagination: {
                page,
                limit,
                total,
                pages
            }
        })
    } catch (err) {
        next(err)
    }

})

router.post('/preflight', async (req, res, next) => {

    try {
        //destructoring issue key
        const { issueKey } = req.body;

        if (!issueKey) {
            return res.status(400).json({ success: false, error: 'Missing issue key' })
        }

        //fetch issue from Jira api: issueKey correct | issueKey inccorect
        const jira = getJiraService();
        const issueResult = await jira.getIssue(issueKey);
        //console.log('Issue Result:', issueResult)
        if (!issueResult.success) {
            const statusCode = issueResult.error.includes('authauthentication') ? 401
                : issueResult.error.includes('forbidden') ? 403
                    : issueResult.error.includes('not found') ? 404
                        : 500

            return res.status(statusCode).json({
                success: false, error: issueResult.error || 'Issue not found'
            });
        }

        const { issue } = issueResult;
        const { fields } = issue;
        const description = jira.extractTextFromADF(fields.description) || '';
        const summary = fields.summary || '';
        const attachments = fields.attachment || [];

        //count attachment
        const imageAttachments = attachments.filter(at => at.mimeType?.startsWith('image/'));

        //estimate token cost
        const contextText = `${summary} ${description}`;
        const contextCharacters = contextText.length;
        const estimatedTokens = Math.ceil(contextCharacters / 4) + (imageAttachments.length * 200);
        const estimatedCost = (estimatedTokens / 1000000) * 0.15 + (8000 / 1000000) * 0.60; // Assume ~8k output tokens


        return res.status(200).json({
            isUiStory: true,
            issueKey,
            title: summary || 'N/A',
            description,
            attachments: attachments.length,
            estimatedTokens,
            estimatedCost: estimatedCost.toFixed(4)
        });

    } catch (error) {
        logger.error('System error: ', error)
        return res.status(500).json({ sucess: false, errorr: `System error: ${logger.error}` })
    }

})

router.post('/testcases', async (req, res, next) => {
    try {
        const { issueKey } = req.body || {};

        if (!issueKey) {
            return res.status(400).json({ success: false, error: "Issue Key is required" })
        }

        const projectKey = extractProject(issueKey);
        let project = null; //get project information in database

        if (projectKey) {
            try {
                project = await findOrCreateProject(projectKey, req.user.email)
            } catch (projectError) {
                logger.warn(`Failed to find/ create project ${projectKey}: ${projectError.message} `)
            }
        }

        //Create generation document
        const generation = new Generation({
            issueKey,
            email: req.user.email,
            project: project ? project._id : undefined,
            mode: 'manual',
            startedAt: new Date()
        });
        await generation.save();

        //Update project stats after generation is saved (cập nhật bản thống kê cho project)
        if (project) {
            const Project = (await import('../models/Project.js')).default;
            const updatedProject = await Project.findById(project._id);
            if (updatedProject) {
                updatedProject.totalGenerations = await Generation.countDocuments({ project: project._id });
                await updatedProject.save();
            }
        }

        //Fetch Jira issue and generate
        const startTime = Date.now();

        const jira = getJiraService();
        const issueResult = await jira.getIssue(issueKey);
        if (!issueResult.success) {
            generation.status = 'failed';
            generation.error = issueResult.error || 'Failed to fetch Jira issue';
            generation.completedAt = new Date();
            await generation.save();

            return res.status(400).json({ success: false, error: generation.error })
        }

        const issue = issueResult.issue;
        const fields = issue.fields;

        //build context
        const summary = fields.summary;
        const description = jira.extractTextFromADF(fields.description) || '';
        const context = `Title: ${summary} Description: ${description}`;

        let markdownContent;
        let tokenUsage = null;
        let cost = null;
        try {
            const openai = getOpenAIService();
            logger.info('Generating test cases with OpenAI (mode: manual)');

            const result = await openai.generateTestCases(context, issueKey);

            if (typeof result === 'string') { markdownContent = result }
            else {
                markdownContent = result.content;
                tokenUsage = result.tokenUsage;
                cost = result.cost;
            }

            if (!markdownContent.startsWith('#')) {
                markdownContent = `# Test Cases for ${issueKey}: ${summary || 'Untitled'} \n\n ${markdownContent}`;
            }

        } catch (err) {
            logger.error(`OpenAI generation failed: ${err.message}`);
            generation.status = 'failed';
            generation.error = `OpenAI generation failed: ${err.message}`;
            generation.completedAt = new Date();
            await generation.save();

            return res.status(500).json({ success: false, error: err.messaga || 'Failed to generate test cases' });
        }

        //-------OK => save the result
        //Calculate generation time
        //Update generation document
        const generatetionTimeSeconds = (Date.now() - startTime) / 1000;
        generation.status = 'completed';
        generation.completedAt = new Date();
        generation.generationTimeSeconds = Math.round(generatetionTimeSeconds * 100) / 100;
        generation.cost = cost;
        generation.tokenUsage = tokenUsage;
        generation.result = {
            markdown: {
                filename: `${issueKey}_testcases_${generation._id}.md`,
                content: markdownContent
            }
        };
        generation.currentVersion = 1;
        generation.versions = [];

        await generation.save();
        logger.info(`Successfully generate issue: ${issueKey}`)

        return res.status(200).json({
            success: true,
            data: {
                generationId: String(generation._id),
                issueKey,
                markdown: generation.result.markdown,
                generationTimeSeconds: generation.generationTimeSeconds,
                cost: generation.cost
            }
        })

    } catch (err) {
        next(err);
    }
})

router.get('/:id/view', async (req, res, next) => {

    try {
        const gen = await Generation.findById(req.params.id);

        if (!gen) {
            return res.status(404).json({ success: false, error: 'Not found' });
        }

        const isOwner = gen.email === req.user.email;
        const isPublishedAndCompleted = gen.published && gen.status === 'completed';

        if (!isOwner && !isPublishedAndCompleted) {
            logger.info("Is not owner or not published")
            return res.status(404).json({ success: false, error: 'Not found' });
        }

        const lastestVersion = gen.versions && gen.versions.length > 0
            ? gen.versions[gen.versions.length - 1]
            : null

        const projectKey = gen.issueKey ? extractProject(gen.issueKey) : null;


        return res.status(200).json({
            success: true,
            data: {
                content: gen.result?.markdown?.content || '',
                filename: gen.result?.markdown?.filename || 'output.md',
                format: 'markdown',
                //Data for header:
                projectKey: projectKey,
                issueKey: gen.issueKey,
                updatedAt: gen.updatedAt,
                //==
                published: gen.published || false,
                publishedAt: gen.publishedAt,
                publishedby: gen.publishedBy,
                currentVersion: gen.currentVersion || 1,
                versions: gen.versions || [],
                lastUpdatedBy: lastestVersion?.updatedBy || gen.email,
                lastUpdatedAt: lastestVersion?.updatedAt || gen.updatedAt || gen.createdAt,
                email: gen.email
            }
        })

    } catch (err) {
        next(err)

    }

})

router.put('/:id/content', async (req, res, next) => {
    try {

        const { content } = req.body;

        //check data: content is string
        if (typeof content !== "string") {
            return res.status(400).json({ success: false, error: "Content must be a string" });
        }

        //find param id in database
        const gen = await Generation.findById(req.params.id);

        //Check id , user, status
        if (!gen || gen.email !== req.user.email) {
            return res.status(400).json({ success: false, error: "Not found or you don't have permission to edit " });
        }

        if (gen.status !== 'completed') {
            return res.status(400).json({ success: false, error: 'Can only update completed generations' });
        }

        //Save current Content as a version before updating
        const currentContent = gen.result?.markdown?.content || '';

        if (currentContent && currentContent !== content) {

            if (!gen.versions) { gen.versions = [] };

            const currentVersionNum = gen.currentVersion || 1;

            const versionExits = gen.versions.some(v => v.version === currentVersionNum);
            console.log('>>>>>versionExits: ', versionExits)
            console.log('>>>>>currentVersionNum: ', currentVersionNum)

            if (!versionExits) {

                gen.versions.push({
                    version: currentVersionNum,
                    content: currentContent,
                    updatedAt: new Date(),
                    updatedBy: req.user.email
                })
                logger.info(`Saved version ${currentVersionNum} to versions array fpr generation ${req.params.id}`)
            }

            //Increment version for the new content
            gen.currentVersion = currentVersionNum + 1;

            logger.info(`Updating denegation ${req.params.id} to version ${gen.currentVersion} `);
        }

        //Update markdown content
        if (!gen.result) gen.result = {};
        if (!gen.result.markdown) gen.result.markdown = {};
        gen.result.markdown.content = content;

        //save into DB
        await gen.save()

        return res.status(200).json({
            success: true,
            data: {
                content: gen.result.markdown.content,
                currentVersion: gen.currentVersion
            }
        })

    } catch (err) {
        next(err)
    }

})

router.put('/:id/publish', async (req, res, next) => {
    try {
        const { published } = req.body;

        if (typeof published !== "boolean") {
            return res.status(400).json({ success: false, error: "Publish must be boolean" });
        }

        const gen = await Generation.findById(req.params.id);

        if (!gen || gen.email !== req.user.email) {
            return res.status(400).json({ success: false, error: "Not found or you don't have permission" });
        }

        if (gen.status !== 'completed') {
            return res.status(400).json({ success: false, error: 'Can only update completed generations' });
        }

        gen.published = published;

        if (published) {
            gen.publishedAt = new Date();
            gen.publishedBy = req.user.email;
            logger.info(`Generation ${req.params.id} published by ${req.user.email}`);
        } else {
            gen.publishedAt = undefined;
            gen.publishedBy = undefined;
            logger.info(`Generation ${req.params.id} unpublished by ${req.user.email}`);
        }

        await gen.save();

        return res.status(200).json({
            success: true,
            data: {
                published: gen.published,
                publishedAt: gen.publishedAt,
                publishedBy: gen.publishedBy
            }
        })
    } catch (err) {
        next(err)
    }
})

router.get('/:id/download', async (req, res, next) => {

    try {

        const gen = await Generation.findById(req.params.id);

        if (!gen) return res.status(404).json({ success: false, error: "ID Not found" })

        //Allow if user is owner OR status completed and published
        const isOwner = await Generation.findById(req.params.id);
        const isCompletedAndPublished = gen.status === 'completed' && gen.published

        if (!isOwner && !isCompletedAndPublished) return res.status(403).json({ success: false, error: "You don't have permission or it is not published or completed" })
        if (gen.status !== 'completed') return res.status(400).json({ success: false, error: "Can only download completed generations" })

        // Set headers for file download
        res.setHeader('Content-Type', 'text/markdown');
        res.setHeader('Content-Disposition', `attachment; filename="${gen.result?.markdown?.filename || 'output.md'}"`);

        return res.send(gen.result.markdown.content || '')
    } catch (err) {
        next(err)

    }
})

router.delete('/:id', async (req, res, next) => {


    try {
        const gen = await Generation.findById(req.params.id);

        if (!gen) return res.status(404).json({ success: false, error: "Generation not found" })
        if (gen.email !== req.user.email) return res.status(403).json({ success: false, error: "You can only delete your own generations" })

        await Generation.findByIdAndDelete(req.params.id);
        return res.status(200).json({ success: true, data: gen })
    } catch (err) {
        next(err)
    }
})


export default router;