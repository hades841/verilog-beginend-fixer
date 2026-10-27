import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { validateWithVivado } from './vivado_validator';

async function run(): Promise<void> {
    const logDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'verilog-helper-test-'));
    const firstCandidate = 'module first_check; endmodule\n';
    const secondCandidate = 'module second_check; endmodule\n';
    try {
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
