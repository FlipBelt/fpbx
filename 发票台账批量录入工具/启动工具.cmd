@echo off
chcp 65001 >nul
cd /d "%~dp0"
set OCR_REGRESSION=1
echo.
echo ===== 发票台账批量录入工具 =====
echo 1. 批量录入“待导入发票.json”
echo 2. 查看近期开票同步记录
echo 3. 按审批实例 ID 或审批编号回滚
echo 4. 登记月度 Excel 链接
echo 5. 按审批编号或实例 ID 追踪
echo 6. 生成历史空白行补录模板
echo 7. 预览历史补录（不写入）
echo 8. 执行历史补录覆盖 B:K 列
echo 9. 回滚一次历史补录
echo 10. 从历史审批附件本地恢复发票字段（不写入）
echo 11. 恢复并写回已清空的历史台账行
echo 12. 修正已恢复行的错列/错字段内容
echo 0. 退出
echo.
set /p ACTION=请选择：
if "%ACTION%"=="1" node "批量录入.mjs" import "待导入发票.json"
if "%ACTION%"=="2" node "批量录入.mjs" status
if "%ACTION%"=="3" (
  set /p INSTANCE_ID=请输入审批实例 ID 或审批编号：
  node "批量录入.mjs" rollback "%INSTANCE_ID%"
)
if "%ACTION%"=="4" (
  set /p MONTH=请输入月份（YYYY-MM）：
  set /p WORKBOOK_URL=请粘贴该月 Excel 链接：
  node "批量录入.mjs" register "%MONTH%" "%WORKBOOK_URL%"
)
if "%ACTION%"=="5" (
  set /p APPROVAL_ID=请输入审批实例 ID 或审批编号：
  node "批量录入.mjs" trace "%APPROVAL_ID%"
)
if "%ACTION%"=="6" (
  set /p MONTH=请输入月份（可留空处理全部）：
  node "批量录入.mjs" repair-template "%MONTH%"
)
if "%ACTION%"=="7" (
  set /p REPAIR_FILE=请输入补录 JSON 文件名：
  node "批量录入.mjs" repair-preview "%REPAIR_FILE%"
)
if "%ACTION%"=="8" (
  set /p REPAIR_FILE=请输入补录 JSON 文件名：
  node "批量录入.mjs" repair-apply "%REPAIR_FILE%"
)
if "%ACTION%"=="9" (
  set /p REPAIR_JOB_ID=请输入补录任务 ID：
  node "批量录入.mjs" repair-rollback "%REPAIR_JOB_ID%"
)
if "%ACTION%"=="10" (
  set /p MONTH=请输入月份（可留空处理全部）：
  node "..\scripts\invoice-ledger-historical-recovery.mjs" recover --execute --period="%MONTH%"
)
if "%ACTION%"=="11" (
  set /p MONTH=请输入月份（可留空处理全部）：
  echo 将只恢复当前为空白的行，并逐行回读校验。
  set /p CONFIRM=确认执行请输入 YES：
  if /I "%CONFIRM%"=="YES" node "..\scripts\invoice-ledger-historical-recovery.mjs" restore --execute --period="%MONTH%"
)
if "%ACTION%"=="12" (
  set /p MONTH=请输入月份（可留空处理全部）：
  echo 将仅覆盖系统此前写入且尚未入账的 B:K 列，并回读校验。
  set /p CONFIRM=确认执行请输入 YES：
  if /I "%CONFIRM%"=="YES" node "..\scripts\invoice-ledger-historical-recovery.mjs" correct --execute --period="%MONTH%"
)
echo.
pause
