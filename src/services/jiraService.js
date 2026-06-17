import { jiraConfig } from '../config/index.js';
import fetch from 'node-fetch';
import { logger } from '../utils/logger.js'

//interact with Jira API, fetch issue details, handle errors, extract text from ADF format
class JiraService {
    //constructor to set up authentication and base URL
    constructor() {
        //check env config
        if (!jiraConfig.email || !jiraConfig.apiToken || !jiraConfig.baseUrl) {
            throw new Error("JIRA credentials are not configured. Please set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN in .env");
        }

        //create credentials matching with Jira form, transfer to binary type then base64 type
        const { email, apiToken, baseUrl } = jiraConfig;
        const credentials = Buffer.from(`${email}:${apiToken}`).toString("base64");

        //create&save this.authHeader, this.baseUrl 
        this.authHeader = `Basic ${credentials}`;
        this.baseUrl = baseUrl;
    }

    //getIssue method
    async getIssue(issueKey) {

        try {

            //check input format
            const normalizedKey = issueKey.trim().toUpperCase();

            if (!/^[A-Z]+-\d+$/.test(normalizedKey)) {
                logger.error(`Invalid issueKey format: ${issueKey}`);
                return {
                    success: false,
                    error: `Invalid issueKey format: ${issueKey}. Expected format: PROJECT-NUMBER. Eg: KAN-1, KAN-219`
                }
            }
            // fetch jira api
            const url = `${this.baseUrl}/rest/api/3/issue/${normalizedKey}?expand=attachments,comments,issuelinks`;
            logger.info(`Fetch JIRA issue: ${normalizedKey} from ${this.baseUrl}`)

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Accept': 'application/json'
                }
            })

            //if response is not ok
            if (!response.ok) {
                const errorText = await response.text();
                let errorMessage = `JIRA API error: ${response.status}`;

                // Parse JIRA error response
                try {
                    const errorJson = JSON.parse(errorText);
                    if (errorJson.errorMessages && errorJson.errorMessages.length > 0) {
                        errorMessage = errorJson.errorMessages[0];
                    } else if (errorJson.message) {
                        errorMessage = errorJson.message;
                    }
                } catch {
                    errorMessage = errorText || errorMessage;
                }

                logger.error(`JIRA API error for ${normalizedKey}: ${response.status} - ${errorMessage}`);

                // Provide helpful messages based on status code
                if (response.status === 401) {
                    return { success: false, error: 'JIRA authentication failed. Please check your JIRA_EMAIL and JIRA_API_TOKEN credentials.' };
                } else if (response.status === 403) {
                    return { success: false, error: `JIRA access forbidden for issue ${normalizedKey}.` };
                } else if (response.status === 404) {
                    return { success: false, error: `Issue ${normalizedKey} not found or you don't have permission to view it.` };
                }

                return {
                    success: false,
                    error: errorMessage
                }
            }

            //if response ok, return
            const issue = await response.json();
            logger.info(`Successfully fetching issue: ${normalizedKey}`);

            return {
                success: true,
                issue
            }
        } catch (error) {
            logger.error(`Failed fetching issue: ${issueKey}`, error)
        }
    }

    //extractADF method
    extractTextFromADF(adf) {
        // Atlassian Document Format text extraction
        // This method is REQUIRED - it converts JIRA's ADF format to plain text
        if (!adf || typeof adf !== 'object') return '';

        if (adf.content && Array.isArray(adf.content)) {
            return adf.content
                .map(node => {
                    if (node.type === 'text' && node.text) {
                        return node.text;
                    }
                    if (node.content) {
                        return this.extractTextFromADF(node);
                    }
                    return '';
                })
                .filter(Boolean)
                .join(' ');
        }

        return '';
    }
}

//export class
export default JiraService;