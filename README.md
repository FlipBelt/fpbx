# 发票报销助手（fpbx）

发票自动报销系统。

这是一个可直接嵌入钉钉 H5 微应用的前端原型，用来演示员工上传发票 PDF 和付款截图后，自动校验金额并生成 OA 报销审批单的完整流程。

发票自动归档同步是其中独立维护的模块，范围、运行约束和灰度上线要求见：[发票自动归档同步项目文档](docs/invoice-ledger-sync.md) 和 [需求清单](docs/invoice-ledger-requirements.md)。

## 现在已经包含

- 发票 PDF、付款截图多文件上传和拖拽上传。
- 按文件类型自动分类：PDF 为发票，JPG/PNG 等图片为付款截图。
- 以发票 PDF 金额作为唯一报销依据，付款截图只用于金额一致性校验。
- 仅校验金额，不校验收款方名称。
- 金额不一致、缺少发票、缺少付款截图或疑似重复发票时，停止提交并生成《报销校验异常报告.md》。
- 金额完全一致时，生成钉钉“日常报销单据”审批请求参数。
- 适配手机和桌面端内嵌窗口。

## 打开方式

直接用浏览器打开：

```text
reimbursement-assistant/index.html
```

也可以用服务端模板预览，并在配置钉钉密钥后正式提交审批。最简单的方式是复制 `dingtalk.config.example.json` 为 `dingtalk.config.json`，填入钉钉信息后运行：

```bash
node reimbursement-assistant/server.mjs
```

也可以继续用环境变量覆盖配置文件里的值。

## 接入钉钉时需要替换的部分

前端保留在钉钉 H5 微应用内，服务端负责保存密钥并调用钉钉 OpenAPI。

1. 在钉钉开放平台创建企业内部 H5 微应用，配置首页地址为本应用上线后的 HTTPS 地址。
2. 前端通过钉钉 JSAPI 获取当前登录用户和上传到钉盘的附件。
3. 服务端使用 AppKey/AppSecret 获取企业内部应用 access token。
4. 服务端把前端生成的草稿转换为“日常报销单据”的审批表单控件字段。
5. 服务端调用发起审批实例接口，把审批提交到 OA 审批中心。

当前服务端模板已预留 `POST /api/approvals`，会读取前端生成的草稿，获取钉钉 access token，并调用 OA 审批创建接口。

## 审批模板映射

- 模板名称：日常报销单据
- Process Code：`PROC-0021DC99-415E-46B6-8B6C-F91F7B48DF6F`
- `field_001`：报销人
- `field_002`：报销部门
- `field_003`：报销日期
- `field_004`：费用明细
- `field_005`：总金额
- `field_006`：附件
- `remark`：AI 金额校验结论

## 建议的服务端接口

```http
POST /api/approvals
Content-Type: application/json
```

请求体建议保持为：

```json
{
  "process_code": "PROC-0021DC99-415E-46B6-8B6C-F91F7B48DF6F",
  "originator_user_id": "钉钉用户ID",
  "dept_id": "部门ID",
  "form_component_values": [],
  "remark": "AI 已校验：金额一致。共处理发票 1 张，总金额 268.00 元。（注：未校验收款方）"
}
```

## 真实 OCR 与验真

演示版根据文件名和文件大小生成识别结果。生产版建议接入发票 OCR、付款截图 OCR 和历史报销库：

- OCR：识别发票代码、号码、金额、税额、开票日期、购买方、销售方。
- 付款截图 OCR：识别转账金额、收款方名称、转账时间；收款方名称只记录，不参与校验。
- 去重：用发票代码、号码、金额、日期做唯一性检查。
- 异常报告：金额不符、缺少截图、解析失败时，生成报告并停止提交。

## 钉钉文档参考

- H5 微应用、免登和 JSAPI：<https://open.dingtalk.com/document/development/make-a-single-call-option-customizable-h5>
- 企业内部应用 access token：<https://open.dingtalk.com/document/development/obtain-orgapp-token>
- 上传附件到钉盘 JSAPI：<https://open.dingtalk.com/tools/explorer/jsapi?id=10318>
- OA 发起审批实例接口：<https://dingtalk.apifox.cn/api-9093218>
