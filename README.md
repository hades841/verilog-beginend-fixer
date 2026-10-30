# Verilog BeginEnd Fixer

为 Verilog / SystemVerilog 代码自动补充缺失的 `begin` / `end`，并在写入前调用 Vivado `xvlog` 校验转换结果。校验失败时，扩展不会修改原文件。

适用于需要快速规范化 `always`、`if`、`else`、`for` 等单语句控制结构的 FPGA 开发场景。

## 项目与反馈

- 源码仓库：[hades841/verilog-beginend-fixer](https://github.com/hades841/verilog-beginend-fixer)
- 问题反馈：[GitHub Issues](https://github.com/hades841/verilog-beginend-fixer/issues)
- 使用中如遇到 Bug、兼容性问题或有功能建议，欢迎发送邮件至 [1842384443@qq.com](mailto:1842384443@qq.com)。我会尽力复现并修复问题。

## 功能

- 自动为需要代码块的控制语句补充 `begin` / `end`。
- `begin` 添加在控制语句行的末尾，并位于该行注释之前。
- 支持 `.v` 与 `.sv` 文件；文件名以 `_tb` 结尾的测试平台文件会跳过处理。
- 写入前使用 Vivado `xvlog` 校验候选代码。
- 校验失败时保持编辑器内容不变，并将 Vivado 输出与完整候选文件写入日志。
- 每次运行覆盖工作区中的同一份日志，便于查看本次结果。

## 使用方法

1. 在 VS Code 中打开 Verilog 或 SystemVerilog 文件。
2. 配置 Vivado 安装目录，例如 `D:\Vivado\2022.2`。
3. 按 `Ctrl+Alt+K`（macOS 为 `Cmd+Alt+K`），或在命令面板执行 `Verilog: Auto add begin-end`。
4. 仅当 `xvlog` 校验通过后，转换结果才会写入当前文件。

## 示例

转换前：

```verilog
always @(posedge clk or negedge rst_n)
    if (!rst_n)
        rx_busy <= 1'b0;
    else if (state != IDLE)
        rx_busy <= 1'b1;
    else
        rx_busy <= 1'b0;
```

转换后：

```verilog
always @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
        rx_busy <= 1'b0;
    end else if (state != IDLE) begin
        rx_busy <= 1'b1;
    end else begin
        rx_busy <= 1'b0;
    end
end
```

行尾注释会被保留在 `begin` 之后：

```verilog
if (enable) begin // 仅在使能时更新
    data <= next_data;
end
```

## 设置

在 VS Code 设置中搜索 `Verilog BeginEnd Fixer`，或在 `settings.json` 中配置：

```json
{
  "verilog-helper.vivadoPath": "D:\\Vivado\\2022.2",
  "verilog-helper.vivadoTimeoutMs": 120000,
  "verilog-helper.vivadoIncludePaths": [
    "D:\\FPGAProject\\common\\include"
  ]
}
```

`verilog-helper.vivadoPath` 可填写 Vivado 安装目录，也可直接填写 `xvlog.bat` 的完整路径。扩展会自动收集当前源文件、相对路径 include 文件及其嵌套 include 文件所在目录，并加入 xvlog 搜索路径；无法从源码路径自动找到的工程公共目录，可通过 `verilog-helper.vivadoIncludePaths` 追加。未配置 Vivado、找不到 `xvlog` 或 `xvlog` 校验失败时，扩展不会写入转换结果。

## 日志

日志文件固定为：

```text
<工作区>/.verilog-helper-logs/vivado-validation.log
```

日志包含 Vivado `xvlog` 输出，以及本次转换后的完整候选代码。每次执行命令都会覆盖旧日志。

## 注意事项

- 建议在版本控制或备份环境中使用批量转换结果。
- `xvlog` 校验用于确认转换后的文件能够通过 Vivado 的 Verilog / SystemVerilog 语法与语义分析；工程级依赖、宏定义与包含目录仍应在对应的 Vivado 工程环境中确认。
