/**
 * begin_end.ts - begin/end 检测与插入逻辑（纯插入，不含代码检查）
 */

function lineEndsWithBegin(trimmed: string): boolean {
    const noComment = trimmed.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//, '');
    return /\bbegin\s*(?::\s*\w+)?\s*$/.test(noComment.trim());
}

function lineStartsWithBegin(trimmed: string): boolean {
    return trimmed.startsWith('begin');
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

function shouldInsertBegin(lines: string[], lineIndex: number, trimmedLine: string): boolean {
    if (lineEndsWithBegin(trimmedLine)) return false;
    const next = getNextEffectiveLine(lines, lineIndex);
    if (next && lineStartsWithBegin(next.trimmed)) return false;
    return true;
}

function isIfLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith('if')) return false;
    const parenIdx = trimmed.indexOf('(');
    if (parenIdx === -1) return false;
    let depth = 0;
    for (let i = parenIdx; i < trimmed.length; i++) {
        if (trimmed[i] === '(') depth++;
        else if (trimmed[i] === ')') {
            depth--;
            if (depth === 0) return true;
        }
    }
    return false;
}

function isElseIfLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith('else')) return false;
    const ifIdx = trimmed.indexOf('if');
    if (ifIdx === -1) return false;
    const parenIdx = trimmed.indexOf('(', ifIdx);
    if (parenIdx === -1) return false;
    let depth = 0;
    for (let i = parenIdx; i < trimmed.length; i++) {
        if (trimmed[i] === '(') depth++;
        else if (trimmed[i] === ')') {
            depth--;
            if (depth === 0) return true;
        }
    }
    return false;
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
    indent: string;
    type: 'always' | 'if' | 'elseif' | 'else' | 'for';
    inlineStmt?: string;
    inCase?: boolean;
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

        if (lineHasKeyword(line) && hasInlineStatement(line)) {
            const keywordTrim = trimmed;
            if (keywordTrim.startsWith('else')) {
                const elseBody = keywordTrim.substring(4).trim();
                if (elseBody && !elseBody.startsWith('if') && !elseBody.startsWith('begin')) {
                    const indent = (line.match(/^(\s*)/) || ['', ''])[1];
                    insertBeginList.push({ lineIndex: i, indent, type: 'else', inlineStmt: elseBody, inCase: caseDepth > 0 });
                } else if (elseBody && elseBody.startsWith('if')) {
                    const indent = (line.match(/^(\s*)/) || ['', ''])[1];
                    insertBeginList.push({ lineIndex: i, indent, type: 'elseif', inlineStmt: '__INLINE__', inCase: caseDepth > 0 });
                }
            } else if (keywordTrim.startsWith('if') || keywordTrim.startsWith('for')) {
                const indent = (line.match(/^(\s*)/) || ['', ''])[1];
                insertBeginList.push({ lineIndex: i, indent, type: keywordTrim.startsWith('for') ? 'for' : 'if', inlineStmt: '__INLINE__', inCase: caseDepth > 0 });
            }
            continue;
        }

        if (trimmed.match(/^always\s*@\s*\([^)]*\)/)) {
            if (shouldInsertBegin(lines, i, trimmed)) {
                insertBeginList.push({ lineIndex: i, indent: (line.match(/^(\s*)/) || ['', ''])[1], type: 'always' });
            }
            continue;
        }

        if (trimmed.match(/^initial\b/)) {
            if (shouldInsertBegin(lines, i, trimmed)) {
                insertBeginList.push({ lineIndex: i, indent: (line.match(/^(\s*)/) || ['', ''])[1], type: 'always' });
            }
            continue;
        }

        if (isIfLine(line)) {
            if (shouldInsertBegin(lines, i, trimmed)) {
                insertBeginList.push({ lineIndex: i, indent: (line.match(/^(\s*)/) || ['', ''])[1], type: 'if', inCase: caseDepth > 0 });
            }
            continue;
        }

        if (isElseIfLine(line)) {
            if (shouldInsertBegin(lines, i, trimmed)) {
                insertBeginList.push({ lineIndex: i, indent: (line.match(/^(\s*)/) || ['', ''])[1], type: 'elseif', inCase: caseDepth > 0 });
            }
            continue;
        }

        if (trimmed.match(/^else\b/)) {
            const next = getNextEffectiveLine(lines, i);
            if (next && (isIfLine(next.line) || isElseIfLine(next.line))) {
                continue;
            }
            if (shouldInsertBegin(lines, i, trimmed)) {
                insertBeginList.push({ lineIndex: i, indent: (line.match(/^(\s*)/) || ['', ''])[1], type: 'else', inCase: caseDepth > 0 });
            }
            continue;
        }

        if (trimmed.match(/^for\s*\(/)) {
            if (shouldInsertBegin(lines, i, trimmed)) {
                insertBeginList.push({ lineIndex: i, indent: (line.match(/^(\s*)/) || ['', ''])[1], type: 'for', inCase: caseDepth > 0 });
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

export function calculateEndPositions(lines: string[], list: InsertPoint[]): BeginEndEdit[] {
    const edits: BeginEndEdit[] = [];
    const N = lines.length;

    const moduleKeywords = /^(module|endmodule|function|endfunction|task|endtask|always|initial|assign|wire|reg|input|output|inout|parameter)\b/;

    for (const point of list) {
        if (point.inlineStmt) {
            if (point.type === 'else' && point.inlineStmt !== '__INLINE__') {
                edits.push({
                    pos: point.lineIndex + 1,
                    text: `${point.indent}begin\n${point.indent}    ${point.inlineStmt}\n${point.indent}end`
                });
                edits.push({
                    pos: point.lineIndex + 1,
                    text: `${point.indent}else\n`,
                    replaceLine: point.lineIndex
                });
            } else if (point.type === 'elseif' || point.type === 'if' || point.type === 'for') {
                const { head, stmt } = parseInlineControl(lines[point.lineIndex]);
                edits.push({
                    pos: point.lineIndex + 1,
                    text: `${point.indent}begin\n${point.indent}    ${stmt}\n${point.indent}end`
                });
                edits.push({
                    pos: point.lineIndex + 1,
                    text: `${point.indent}${head}\n`,
                    replaceLine: point.lineIndex
                });
            }
            continue;
        }

        // 正常插入 begin
        edits.push({ pos: point.lineIndex + 1, text: point.indent + 'begin' });

        let endPos = N;
        let depth = 0;
        let caseLevel = 0;

        for (let i = point.lineIndex + 1; i < N; i++) {
            const trimmed = lines[i].trim();
            if (trimmed === "" || trimmed.startsWith("//")) continue;

            if (trimmed.match(/^case\s*\(/) || trimmed.match(/^case\s+/)) caseLevel++;
            if (trimmed === 'endcase') {
                if (caseLevel > 0) caseLevel--;
                if (point.inCase && caseLevel === 0) {
                    endPos = i;
                    break;
                }
            }
            if (caseLevel > 0) continue;

            if (lineStartsWithBegin(trimmed) || lineEndsWithBegin(trimmed)) depth++;
            if (trimmed === 'end') {
                if (depth > 0) depth--;
                else {
                    endPos = i;
                    break;
                }
            }

            if (depth === 0) {
                if (point.type === 'if' || point.type === 'elseif' || point.type === 'else') {
                    if (isIfLine(lines[i]) || isElseIfLine(lines[i]) || /^else\b/.test(trimmed)) {
                        endPos = i;
                        break;
                    }
                    // 遇到普通行就停（只包一行）
                    if (!lineStartsWithBegin(trimmed) && !lineEndsWithBegin(trimmed)) {
                        endPos = i + 1;
                        break;
                    }
                } else if (point.type === 'always') {
                    if (trimmed.match(/^always\s*@\s*\(/) || trimmed.match(/^initial\b/) || moduleKeywords.test(trimmed)) {
                        endPos = i;
                        break;
                    }
                }
            }
        }

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