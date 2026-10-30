import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildXvlogArgs, collectIncludeDirectories, getIncludeDirectories, validateWithVivado } from './vivado_validator';

async function run(): Promise<void> {
    const logDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'verilog-helper-test-'));
    const firstCandidate = 'module first_check; endmodule\n';
    const secondCandidate = 'module second_check; endmodule\n';
    try {
        const sourcePath = path.join('project', 'rtl', 'top.v');
        const includeDirectories = getIncludeDirectories(sourcePath, [path.join('project', 'include'), path.join('project', 'rtl')]);
        assert.deepStrictEqual(includeDirectories, [
            path.resolve('project', 'rtl'),
            path.resolve('project', 'include')
        ]);
        assert.deepStrictEqual(
            buildXvlogArgs(sourcePath, path.join('temporary', 'top.v'), [path.join('project', 'include')]),
            ['-i', path.resolve('project', 'rtl'), '-i', path.resolve('project', 'include'), path.join('temporary', 'top.v')]
        );

        const includeProject = await fs.mkdtemp(path.join(os.tmpdir(), 'verilog-helper-include-project-'));
        try {
            const sourcePath = path.join(includeProject, 'rtl', 'top.v');
            const registerFile = path.join(includeProject, 'qwe', 'reg_define.v');
            const nestedFile = path.join(includeProject, 'qwe', 'nested', 'common.v');
            await fs.mkdir(path.dirname(nestedFile), { recursive: true });
            await fs.writeFile(registerFile, '`include "nested/common.v"\n', 'utf8');
            await fs.writeFile(nestedFile, '`define TEST_VALUE 1\n', 'utf8');
            assert.deepStrictEqual(
                await collectIncludeDirectories(sourcePath, '`include "../qwe/reg_define.v"\n'),
                [path.resolve(includeProject, 'rtl'), path.resolve(includeProject, 'qwe'), path.resolve(includeProject, 'qwe', 'nested')]
            );
        } finally {
            await fs.rm(includeProject, { recursive: true, force: true });
        }

        const missing = await validateWithVivado('syntax_check.v', firstCandidate, logDirectory, '', 1000);
        assert.strictEqual(missing.success, false);
        assert.ok((await fs.readFile(missing.logPath, 'utf8')).includes(firstCandidate));

        const invoked = await validateWithVivado('syntax_check.v', secondCandidate, logDirectory, process.execPath, 10000);
        assert.strictEqual(invoked.success, false);
        assert.strictEqual(invoked.logPath, missing.logPath);
        const log = await fs.readFile(invoked.logPath, 'utf8');
        assert.ok(log.includes('===== Vivado xvlog 输出 ====='));
        assert.ok(log.includes('===== 转换后的完整文件 ====='));
        assert.ok(log.includes(secondCandidate));
        assert.ok(!log.includes(firstCandidate));
    } finally {
        await fs.rm(logDirectory, { recursive: true, force: true });
    }
}

run().then(() => console.log('Vivado 校验日志用例通过'));
