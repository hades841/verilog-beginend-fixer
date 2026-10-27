/**
 * begin_end.ts - begin/end 检测与插入逻辑（纯插入，不含代码检查）
 */

function removeLineComments(line: string): string {
    return line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
}

function findConditionEnd(lines: string[], startLineIndex: number): number {
    let depth = 0;
    let foundOpen = false;

    for (let i = startLineIndex; i < lines.length; i++) {
        const noComment = removeLineComments(lines[i]);
        for (let j = 0; j < noComment.length; j++) {
            if (noComment[j] === '(') { depth++; foundOpen = true; }
            else if (noComment[j] === ')') { depth--; }
        }
        if (foundOpen && depth === 0) {
            return i;
        }
    }
    return startLineIndex;
}

function lineEndsWithBegin(trimmed: string): boolean {
    const noComment = removeLineComments(trimmed);
    return /\bbegin\s*(?::\s*\w+)?\s*$/.test(noComment.trim());
}

function lineStartsWithBegin(trimmed: string): boolean {
    return trimmed.startsWith('begin');
}

// 将 begin 追加到代码末尾，并保留行尾注释。
function appendBeginToLine(line: string): string {
    const lineComment = line.indexOf('//');
    const blockComment = line.match(/\/\*.*\*\/\s*$/)?.index ?? -1;
    const commentIndex = lineComment >= 0 ? lineComment : blockComment >= 0 ? blockComment : line.length;
    const code = line.substring(0, commentIndex).trimEnd();
    const comment = line.substring(commentIndex).trim();
    return `${code} begin${comment ? ` ${comment}` : ''}`;
}

function getNextEffectiveLine(lines: string[], fromIndex: number): { line: string; trimmed: string; index: number } | null {
    let i = fromIndex + 1;
    while (i < lines.length) {
        const trimmed = lines[i].trim();
        if (trimmed === "" || trimmed.startsWith("//")) {
            i++;
            continue;
        }
        return { line: lines[i], trimmed, index: i };
    }
    return null;
}

function shouldInsertBegin(lines: string[], lineIndex: number, condEndLine: number): boolean {
    if (lineEndsWithBegin(lines[lineIndex].trim())) return false;
    const next = getNextEffectiveLine(lines, condEndLine);
    if (next && lineStartsWithBegin(next.trimmed)) return false;
    return true;
}

function hasInlineStatement(line: string): boolean {
    const noLineComment = line.replace(/\/\/.*$/, '');
    const noBlockComment = noLineComment.replace(/\/\*.*?\*\//, '').trim();
    if (noBlockComment === '') return false;
    if (/\bbegin\s*(?::\s*\w+)?\s*$/.test(noBlockComment)) return false;
    if (/\)\s*$/.test(noBlockComment)) return false;

    const elseMatch = noBlockComment.match(/^else\s+(.*)/);
    if (elseMatch) {
        const afterElse = elseMatch[1].trim();
        if (afterElse.startsWith('if')) {
            let p = afterElse.indexOf('(');
            if (p >= 0) {
                let depth = 0;
                for (let i = p; i < afterElse.length; i++) {
                    if (afterElse[i] === '(') depth++;
                    else if (afterElse[i] === ')') {
                        depth--;
                        if (depth === 0) {
                            let rest = afterElse.substring(i + 1).trim();
                            if (rest.includes(';')) return true;
                            break;
                        }
                    }
                }
            }
            return false;
        }
        if (afterElse && !afterElse.startsWith('begin')) {
            return true;
        }
    }

    if (/^if\s*\(/.test(noBlockComment) || /^for\s*\(/.test(noBlockComment)) {
        let depth = 0;
        for (let i = 0; i < noBlockComment.length; i++) {
            const char = noBlockComment[i];
            if (char === '(') depth++;
            else if (char === ')') depth--;
            else if (char === ';' && depth === 0) return true;
        }
    }
    return false;
}

function lineHasKeyword(line: string): boolean {
    const trimmed = line.trim();
    return /^always\s*@\s*\(/.test(trimmed) ||
           /^initial\b/.test(trimmed) ||
           trimmed.startsWith('if') ||
           trimmed.startsWith('else') ||
           /^for\s*\(/.test(trimmed);
}

function isCaseLabel(line: string): boolean {
    const t = line.trim();
    if (/^\d+\s*'[bdh]?\w*\s*:/.test(t)) return true;
    if (/^default\s*:/.test(t)) return true;
    if (/^\w+\s*:/.test(t) && !lineHasKeyword(line) && !t.startsWith('begin') && !t.startsWith('end')) return true;
    return false;
}

function parseInlineControl(line: string): { head: string, stmt: string } {
    const trimmed = line.trim();
    let p = trimmed.indexOf('(');
    if (p < 0) return { head: trimmed, stmt: trimmed };
    let depth = 0;
    let endParen = -1;
    for (let i = p; i < trimmed.length; i++) {
        if (trimmed[i] === '(') depth++;
        else if (trimmed[i] === ')') { depth--; if (depth === 0) { endParen = i; break; } }
    }
    if (endParen < 0) return { head: trimmed, stmt: trimmed };
    const head = trimmed.substring(0, endParen + 1);
    let stmt = trimmed.substring(endParen + 1).trim();
    return { head, stmt };
}

export interface InsertPoint {
    lineIndex: number;
    condEndLine?: number;
    indent: string;
    type: 'always' | 'if' | 'elseif' | 'else' | 'for';
    inlineStmt?: string;
}

export interface BeginEndEdit {
    pos: number;
    text: string;
    replaceLine?: number;
}

export function analyzeBeginEnd(lines: string[]): { success: boolean; message: string; insertBeginList: InsertPoint[]; totalLines: number } {
    const insertBeginList: InsertPoint[] = [];
    const totalLines = lines.length;
    let caseDepth = 0;

    for (let i = 0; i < totalLines; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed === "" || trimmed.startsWith("//")) continue;

        if (trimmed.match(/^case\s*\(/) || trimmed.match(/^case\s+/)) {
            caseDepth++;
        }
        if (trimmed === 'endcase' && caseDepth > 0) {
            caseDepth--;
        }

        if (caseDepth > 0 && isCaseLabel(line)) {
            continue;
        }

        // ===== always =====
        if (trimmed.match(/^always\s*@\s*\([^)]*\)/)) {
            const condEndLine = findConditionEnd(lines, i);
            const condEndCode = removeLineComments(lines[condEndLine]);
            const afterParen = condEndCode.substring(condEndCode.lastIndexOf(')') + 1).trim();

            if (afterParen && !afterParen.startsWith('begin') && !afterParen.startsWith('//') && afterParen !== ';') {
                const indent = (line.match(/^(\s*)/) || ['', ''])[1];
                insertBeginList.push({ lineIndex: i, indent, type: 'always', inlineStmt: '__INLINE__' });
            } else {
                if (shouldInsertBegin(lines, i, condEndLine)) {
                    const indent = (line.match(/^(\s*)/) || ['', ''])[1];
                    insertBeginList.push({ lineIndex: i, condEndLine: condEndLine !== i ? condEndLine : undefined, indent, type: 'always' });
                }
            }
            continue;
        }

        // ===== initial =====
        if (trimmed.match(/^initial\b/)) {
            const afterInitial = trimmed.substring(7).trim();
            if (afterInitial && !afterInitial.startsWith('begin') && !afterInitial.startsWith('//')) {
                const indent = (line.match(/^(\s*)/) || ['', ''])[1];
                insertBeginList.push({ lineIndex: i, indent, type: 'always', inlineStmt: '__INLINE__' });
            } else {
                if (shouldInsertBegin(lines, i, i)) {
                    insertBeginList.push({ lineIndex: i, indent: (line.match(/^(\s*)/) || ['', ''])[1], type: 'always' });
                }
            }
            continue;
        }

        // ===== else =====
        if (trimmed.match(/^(?:end\s+)?else\b/)) {
            const elseBody = trimmed.replace(/^(?:end\s+)?else\b/, '').trim();

            if (elseBody.startsWith('if')) {
                const condEndLine = findConditionEnd(lines, i);
                const condEndTrimmed = lines[condEndLine].trim();

                const nextAfterCond = getNextEffectiveLine(lines, condEndLine);
                if (nextAfterCond && lineStartsWithBegin(nextAfterCond.trimmed)) continue;
                if (lineEndsWithBegin(condEndTrimmed)) continue;

                if (condEndLine === i && hasInlineStatement(line)) {
                    const indent = (line.match(/^(\s*)/) || ['', ''])[1];
                    insertBeginList.push({ lineIndex: i, indent, type: 'elseif', inlineStmt: '__INLINE__' });
                } else {
                    if (shouldInsertBegin(lines, i, condEndLine)) {
                        const indent = (line.match(/^(\s*)/) || ['', ''])[1];
                        insertBeginList.push({ lineIndex: i, condEndLine: condEndLine !== i ? condEndLine : undefined, indent, type: 'elseif' });
                    }
                }
                continue;
            }

            if (elseBody === '') {
                const next = getNextEffectiveLine(lines, i);
                if (next && next.trimmed.startsWith('if')) {
                    // 换行的 else/if 是嵌套语句，不能按 else if 处理。
                    if (shouldInsertBegin(lines, i, i)) {
                        const indent = (line.match(/^(\s*)/) || ['', ''])[1];
                        insertBeginList.push({ lineIndex: i, indent, type: 'else' });
                    }
                } else {
                    if (shouldInsertBegin(lines, i, i)) {
                        const indent = (line.match(/^(\s*)/) || ['', ''])[1];
                        insertBeginList.push({ lineIndex: i, indent, type: 'else' });
                    }
                }
                continue;
            }

            if (!elseBody.startsWith('begin')) {
                if (hasInlineStatement(line)) {
                    const indent = (line.match(/^(\s*)/) || ['', ''])[1];
                    insertBeginList.push({ lineIndex: i, indent, type: 'else', inlineStmt: elseBody });
                } else {
                    if (shouldInsertBegin(lines, i, i)) {
                        const indent = (line.match(/^(\s*)/) || ['', ''])[1];
                        insertBeginList.push({ lineIndex: i, indent, type: 'else' });
                    }
                }
            }
            continue;
        }

        // ===== if =====
        if (trimmed.startsWith('if')) {
            const condEndLine = findConditionEnd(lines, i);
            const condEndTrimmed = lines[condEndLine].trim();

            if (lineEndsWithBegin(condEndTrimmed)) continue;
            const nextAfterCond = getNextEffectiveLine(lines, condEndLine);
            if (nextAfterCond && lineStartsWithBegin(nextAfterCond.trimmed)) continue;

            // 检查 if 后是否紧跟 else/else if
            if (condEndLine === i && hasInlineStatement(line)) {
                const indent = (line.match(/^(\s*)/) || ['', ''])[1];
                insertBeginList.push({ lineIndex: i, indent, type: 'if', inlineStmt: '__INLINE__' });
            } else {
                if (shouldInsertBegin(lines, i, condEndLine)) {
                    const indent = (line.match(/^(\s*)/) || ['', ''])[1];
                    insertBeginList.push({ lineIndex: i, condEndLine: condEndLine !== i ? condEndLine : undefined, indent, type: 'if' });
                }
            }
            continue;
        }

        // ===== for =====
        if (trimmed.match(/^for\s*\(/)) {
            const condEndLine = findConditionEnd(lines, i);
            const condEndTrimmed = lines[condEndLine].trim();

            if (lineEndsWithBegin(condEndTrimmed)) continue;
            const nextAfterCond = getNextEffectiveLine(lines, condEndLine);
            if (nextAfterCond && lineStartsWithBegin(nextAfterCond.trimmed)) continue;

            if (condEndLine === i && hasInlineStatement(line)) {
                const indent = (line.match(/^(\s*)/) || ['', ''])[1];
                insertBeginList.push({ lineIndex: i, indent, type: 'for', inlineStmt: '__INLINE__' });
            } else {
                if (shouldInsertBegin(lines, i, condEndLine)) {
                    const indent = (line.match(/^(\s*)/) || ['', ''])[1];
                    insertBeginList.push({ lineIndex: i, condEndLine: condEndLine !== i ? condEndLine : undefined, indent, type: 'for' });
                }
            }
            continue;
        }
    }

    return {
        success: true,
        message: `分析完成，需补 ${insertBeginList.length} 组 begin-end`,
        insertBeginList,
        totalLines
    };
}

/** 返回从 startLine 开始的完整语句之后的行号。 */
function findBeginEndBlockEnd(lines: string[], startLine: number): number {
    let depth = 0;
    for (let i = startLine; i < lines.length; i++) {
        const text = lines[i].replace(/\/\/.*$/, '').trim();
        if (lineStartsWithBegin(text) || lineEndsWithBegin(text)) depth++;
        if (/^end\b/.test(text) && --depth === 0) return i + 1;
    }
    return lines.length;
}

function findStatementEnd(lines: string[], startLine: number): number {
    const first = getNextEffectiveLine(lines, startLine - 1);
    if (!first) return lines.length;

    const index = first.index;
    const trimmed = first.trimmed;
    if (lineStartsWithBegin(trimmed)) {
        return findBeginEndBlockEnd(lines, index);
    }

    if (/^case(?:x|z)?\b/.test(trimmed)) {
        let depth = 0;
        for (let i = index; i < lines.length; i++) {
            const text = lines[i].replace(/\/\/.*$/, '').trim();
            if (/^case(?:x|z)?\b/.test(text)) depth++;
            if (text === 'endcase' && --depth === 0) return i + 1;
        }
        return lines.length;
    }

    if (/^else\b/.test(trimmed) && !/^else\s+if\b/.test(trimmed)) {
        const body = trimmed.substring(4).trim();
        if (body === '') return findStatementEnd(lines, index + 1);
        if (lineEndsWithBegin(trimmed)) return findBeginEndBlockEnd(lines, index);
        return index + 1;
    }

    const isIf = /^if\s*\(/.test(trimmed) || /^else\s+if\s*\(/.test(trimmed);
    const isControl = isIf || /^for\s*\(/.test(trimmed) || /^always\b/.test(trimmed) || /^initial\b/.test(trimmed);
    if (!isControl) return index + 1;

    const conditionEnd = /^initial\b/.test(trimmed) ? index : findConditionEnd(lines, index);
    const conditionText = lines[conditionEnd].replace(/\/\/.*$/, '').trim();
    const afterCondition = /^initial\b/.test(trimmed)
        ? conditionText.substring('initial'.length).trim()
        : conditionText.substring(conditionText.lastIndexOf(')') + 1).trim();
    const isInlineStatement = afterCondition !== '' && !afterCondition.startsWith('begin');
    let end = isInlineStatement
        ? conditionEnd + 1
        : afterCondition.startsWith('begin')
            ? findBeginEndBlockEnd(lines, conditionEnd)
            : findStatementEnd(lines, conditionEnd + 1);
    // 外层 if 的分支可能是未加 begin/end 的嵌套 if/else。
    if (isIf) {
        const next = getNextEffectiveLine(lines, end - 1);
        if (next && /^else\b/.test(next.trimmed)) end = findStatementEnd(lines, next.index);
    }
    return end;
}

function findControlBodyEnd(lines: string[], point: InsertPoint): number {
    if (point.type === 'else') return findStatementEnd(lines, point.lineIndex + 1);
    return findStatementEnd(lines, (point.condEndLine ?? point.lineIndex) + 1);
}

export function calculateEndPositions(lines: string[], list: InsertPoint[]): BeginEndEdit[] {
    const edits: BeginEndEdit[] = [];

    for (const point of list) {

        // ===== 内联语句处理 =====
        if (point.inlineStmt) {
            if (point.type === 'always') {
                const line = lines[point.lineIndex];
                const trimmed = line.trim();
                let head: string, stmt: string;
                if (trimmed.startsWith('always')) {
                    let lastParen = trimmed.lastIndexOf(')');
                    if (lastParen < 0) lastParen = 0;
                    head = trimmed.substring(0, lastParen + 1);
                    stmt = trimmed.substring(lastParen + 1).trim();
                } else if (trimmed.startsWith('initial')) {
                    head = 'initial';
                    stmt = trimmed.substring(7).trim();
                } else {
                    head = trimmed;
                    stmt = '';
                }
                edits.push({
                    pos: point.lineIndex + 1,
                    text: `${point.indent}${head} begin\n${point.indent}    ${stmt}\n${point.indent}end`,
                    replaceLine: point.lineIndex
                });
            } else if (point.type === 'else' && point.inlineStmt !== '__INLINE__') {
                edits.push({
                    pos: point.lineIndex + 1,
                    text: `${point.indent}else begin\n${point.indent}    ${point.inlineStmt}\n${point.indent}end`,
                    replaceLine: point.lineIndex
                });
            } else if (point.type === 'elseif' || point.type === 'if' || point.type === 'for') {
                const { head, stmt } = parseInlineControl(lines[point.lineIndex]);
                edits.push({
                    pos: point.lineIndex + 1,
                    text: `${point.indent}${head} begin\n${point.indent}    ${stmt}\n${point.indent}end`,
                    replaceLine: point.lineIndex
                });
            }
            continue;
        }

        // ===== 非内联：插入 begin =====
        const beginLine = point.condEndLine ?? point.lineIndex;
        edits.push({
            pos: beginLine + 1,
            text: appendBeginToLine(lines[beginLine]),
            replaceLine: beginLine
        });

        const endPos = findControlBodyEnd(lines, point);
        edits.push({ pos: endPos, text: point.indent + 'end' });
    }

    edits.sort((a, b) => {
        if (a.replaceLine !== undefined && b.replaceLine === undefined) return -1;
        if (a.replaceLine === undefined && b.replaceLine !== undefined) return 1;
        return b.pos - a.pos;
    });
    return edits;
}

export function applyEdits(lines: string[], edits: BeginEndEdit[]): string[] {
    const result = [...lines];
    for (const edit of edits) {
        if (edit.replaceLine !== undefined) {
            result[edit.replaceLine] = edit.text.trimEnd();
        } else {
            result.splice(edit.pos, 0, edit.text);
        }
    }
    return result;
}

