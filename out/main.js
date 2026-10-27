"use strict";
/**
 * main.ts - 入口 + 主编排逻辑
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.processDocument = processDocument;
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const begin_end_1 = require("./begin_end");
const vivado_validator_1 = require("./vivado_validator");
async function processDocument() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("没有打开的编辑器");
        return;
    }
    const doc = editor.document;
    const fileName = doc.fileName;
    // 文件类型判断
    if (!fileName.endsWith(".v") && !fileName.endsWith(".sv")) {
        vscode.window.showWarningMessage("当前不是 v/sv 文件");
        return;
    }
    // .v/.sv文件且文件名以 _tb 结尾 → 跳过
    if (fileName.endsWith(".v") || fileName.endsWith(".sv")) {
        const baseName = fileName.substring(0, fileName.length - 2);
        if (baseName.endsWith("_tb")) {
            vscode.window.showInformationMessage("Testbench 文件不进行处理");
            return;
        }
    }
    if (doc.lineCount === 0) {
        vscode.window.showInformationMessage("文件为空");
        return;
    }
    const text = doc.getText();
    const lines = text.split(/\r?\n/);
    // ========= begin/end 处理 =========
    const beginEndResult = (0, begin_end_1.analyzeBeginEnd)(lines);
    if (!beginEndResult.success) {
        vscode.window.showErrorMessage(beginEndResult.message);
        return;
    }
    const beginEdits = (0, begin_end_1.calculateEndPositions)(lines, beginEndResult.insertBeginList);
    // 区分 replaceLine（替换原行）和 pos（插入新行）
    let outputLines = [...lines];
    const replaces = beginEdits.filter(e => e.replaceLine !== undefined);
    const inserts = beginEdits.filter(e => e.replaceLine === undefined);
    // 先处理替换（不影响行号）
    for (const op of replaces) {
        outputLines[op.replaceLine] = op.text.trimEnd();
    }
    // 再处理插入（倒序，避免行号偏移）
    inserts.sort((a, b) => b.pos - a.pos);
    for (const op of inserts) {
        outputLines.splice(op.pos, 0, op.text);
    }
    // ========= 写入文件 =========
    const finalText = outputLines.join("\n");
    const config = vscode.workspace.getConfiguration('verilog-helper');
    const workspacePath = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath ?? path.dirname(fileName);
    const vivadoResult = await (0, vivado_validator_1.validateWithVivado)(fileName, finalText, path.join(workspacePath, '.verilog-helper-logs'), config.get('vivadoPath', ''), config.get('vivadoTimeoutMs', 120000));
    if (!vivadoResult.success) {
        vscode.window.showErrorMessage(`${vivadoResult.message} 未修改文件；日志：${vivadoResult.logPath}`);
        return;
    }
    const lastLine = doc.lineAt(doc.lineCount - 1);
    const fullRange = new vscode.Range(new vscode.Position(0, 0), lastLine.range.end);
    await editor.edit((editBuilder) => {
        editBuilder.replace(fullRange, finalText);
    });
    vscode.window.showInformationMessage(`处理完成：补 ${beginEndResult.insertBeginList.length} 组 begin-end；Vivado 日志：${vivadoResult.logPath}`);
}
function activate(context) {
    const disposable = vscode.commands.registerCommand("verilog-helper.fixBeginEnd", processDocument);
    context.subscriptions.push(disposable);
}
function deactivate() { }
