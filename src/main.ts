/**
 * main.ts - 入口 + 主编排逻辑
 */

import * as vscode from 'vscode';
import { analyzeBeginEnd, calculateEndPositions, BeginEndEdit } from './begin_end';

// 检查 VS Code 诊断错误
function checkVSCodeDiagnostics(): string | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;

    const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
    const errors = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);

    if (errors.length > 0) {
        const firstError = errors[0];
        return `代码有问题，请修改：VS Code 检测到第 ${firstError.range.start.line + 1} 行有错误 - "${firstError.message}"`;
    }
    return null;
}

export async function processDocument() {
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
    if (fileName.endsWith(".v")||fileName.endsWith(".sv")) {
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

    // ========= 前置检查 =========

    // 1. VS Code 诊断检查
    const diagError = checkVSCodeDiagnostics();
    if (diagError) {
        vscode.window.showErrorMessage(diagError);
        return;
    }
    // ========= begin/end 处理 =========
    const beginEndResult = analyzeBeginEnd(lines);

    if (!beginEndResult.success) {
        vscode.window.showErrorMessage(beginEndResult.message);
        return;
    }

    const beginEdits: BeginEndEdit[] = calculateEndPositions(lines, beginEndResult.insertBeginList);

    // 区分 replaceLine（替换原行）和 pos（插入新行）
    let outputLines = [...lines];
    const replaces = beginEdits.filter(e => e.replaceLine !== undefined);
    const inserts = beginEdits.filter(e => e.replaceLine === undefined);

    // 先处理替换（不影响行号）
    for (const op of replaces) {
        outputLines[op.replaceLine!] = op.text.trimEnd();
    }

    // 再处理插入（倒序，避免行号偏移）
    inserts.sort((a, b) => b.pos - a.pos);
    for (const op of inserts) {
        outputLines.splice(op.pos, 0, op.text);
    }

    // ========= 写入文件 =========
    const finalText = outputLines.join("\n");
    const lastLine = doc.lineAt(doc.lineCount - 1);
    const fullRange = new vscode.Range(
        new vscode.Position(0, 0),
        lastLine.range.end
    );

    await editor.edit((editBuilder) => {
        editBuilder.replace(fullRange, finalText);
    });

    vscode.window.showInformationMessage(`处理完成：补 ${beginEndResult.insertBeginList.length} 组 begin-end，请务必核对代码！`);
}

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand(
        "verilog-helper.fixBeginEnd",
        processDocument
    );
    context.subscriptions.push(disposable);
}

export function deactivate() {}