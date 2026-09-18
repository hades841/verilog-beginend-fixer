/**
 * main.ts - 入口 + 主编排逻辑
 */

import * as vscode from 'vscode';
import { analyzeBeginEnd, calculateEndPositions } from './begin_end';

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

    // .v 文件且文件名以 _tb 结尾 → 跳过
    if (fileName.endsWith(".v")) {
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
    const beginEndResult = analyzeBeginEnd(lines);

    if (!beginEndResult.success) {
        vscode.window.showErrorMessage(beginEndResult.message);
        return;
    }

    let outputLines = [...lines];
    let beginCount = beginEndResult.insertBeginList.length;

    const beginEdits = calculateEndPositions(lines, beginEndResult.insertBeginList);

    if (beginEdits.length > 0) {
        beginEdits.sort((a, b) => b.pos - a.pos);
        for (const op of beginEdits) {
            outputLines.splice(op.pos, 0, op.text);
        }
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

    vscode.window.showInformationMessage(`处理完成：补 ${beginCount} 组 begin-end，请务必核对代码！`);
}

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand(
        "verilog-helper.fixBeginEnd",
        processDocument
    );
    context.subscriptions.push(disposable);
}

export function deactivate() {}