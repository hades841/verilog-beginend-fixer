# 更新日志

## 1.3.3

- 在主 README 中新增英文功能说明与快速使用指南。
- 更新 Marketplace 英文简介。

## 1.3.2

### 更新报告

- 修复候选文件写入临时目录后，Vivado `xvlog` 无法解析源文件同目录 `include` 文件的问题。
- 校验时自动将源文件所在目录通过 `-i` 传给 `xvlog`。
- 递归收集相对路径与嵌套 `include` 文件所在目录，例如 `include "..\\qwe\\reg_define.v"` 及其二级包含文件。
- 新增 `verilog-helper.vivadoIncludePaths`，用于配置工程中额外的 `include` 搜索目录。
- Vivado 日志新增本次实际使用的 include 搜索目录，方便定位工程路径配置问题。

## 1.3.1

- 补充 GitHub 源码仓库、Issue 反馈入口与联系邮箱。

## 1.3.0

- 自动补充 Verilog / SystemVerilog 控制语句缺失的 `begin` / `end`。
- 在写入文件前使用 Vivado `xvlog` 校验候选代码。
- 校验日志包含 Vivado 输出及转换后的完整文件，并在每次运行时覆盖。
