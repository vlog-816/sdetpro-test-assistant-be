import mongoose from "mongoose";

/*
* Sub - schema
*/

//Markdown schema

const markdownSchema = new mongoose.Schema({
    content: { type: String },
    filename: { type: String }
}, { _id: false });

//Jira ticket Schema
const jiraTicketSchema = new mongoose.Schema({
    issueUrl: { type: String },
    issueType: { type: String },
    createAt: { type: Date }
}, { _id: false });

//PDF attachment
const pdfAttachmentSchema = new mongoose.Schema({
    attachmentId: { type: String },
    filename: { type: String },
    attachedAt: { type: Date },
    commentId: { type: String }
}, { _id: false });

//Version schema
const versionSchema = new mongoose.Schema({
    version: { type: Number, require: true },
    content: { type: String, require: true },
    updatedAt: { type: Date, default: Date.now },
    updatedBy: { type: String, require: true },
    notes: { type: String }
}, { _id: false });

/**
 * Main schema - Generation schema
 */

const generationSchema = new mongoose.Schema({
    issueKey: { type: String, index: true },
    email: { type: String, index: true },
    project: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        index: true
    },
    mode: { type: String, enum: ['manual', 'auto'] },
    status: { type: String, enum: ['completed', 'failed'] },
    createdAt: { type: Date, default: Date.now },
    startedAt: { type: Date },
    completedAt: { type: Date },
    generationTimeSeconds: { type: Number },
    cost: { type: Number },
    tokenUsage: {
        promptToken: { type: Number },
        completionToken: { type: Number },
        totalToken: { type: Number },
    },
    result: {
        markdown: { type: markdownSchema }
    },
    jiraTickets: [jiraTicketSchema],
    pdfAttachment: [pdfAttachmentSchema],
    error: { type: String },
    published: { type: Boolean, default: false, index: true },
    publishedAt: { type: Date },
    publishedBy: { type: String },
    versions: [versionSchema],
    currentVersion: { type: Number, default: 1 }

}, { timestamps: true }
)

export default mongoose.model('Generation', generationSchema);