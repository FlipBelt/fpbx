import json
import re
import sys
from pathlib import Path

import pdfplumber


def first_match(patterns, text):
    for pattern in patterns:
        match = re.search(pattern, text, re.S)
        if match:
            return match.group(1).strip()
    return None


business_id = sys.argv[1] if len(sys.argv) > 1 else ""
if not re.fullmatch(r"\d{12,32}", business_id):
    raise SystemExit("请提供审批业务编号。")

root = (
    Path(__file__).resolve().parent.parent
    / "artifacts"
    / f"approval-{business_id}-files"
)
approval = json.loads(
    (
        Path(__file__).resolve().parent.parent
        / "artifacts"
        / f"approval-{business_id}.json"
    ).read_text(encoding="utf-8")
)
company = next(
    (
        item.get("value", "")
        for item in approval.get("formComponentValues", [])
        if item.get("name") == "需要付款的公司名称"
    ),
    "",
)
if company.startswith("["):
    try:
        company_values = json.loads(company)
        company = str(company_values[0] if company_values else "")
    except json.JSONDecodeError:
        pass

results = []
for path in sorted(root.rglob("*.pdf")):
    with pdfplumber.open(path) as pdf:
        text = "\n".join(page.extract_text() or "" for page in pdf.pages)

    relative_parts = path.relative_to(root).parts
    row_name = relative_parts[0] if relative_parts else ""
    is_invoice = "发票号码" in text and "价税合计" in text
    is_itinerary = "行程单" in text and not is_invoice
    buyer = first_match(
        [
            r"购\s*名称[：:]\s*(.+?)\s+销\s*名称",
            r"购买方(?:信息)?[\s\S]{0,80}?名称[：:]\s*(.+?)(?:\s{2,}|统一社会信用代码)",
        ],
        text,
    )
    amount = first_match(
        [
            r"价税合计[\s\S]{0,100}?[（(]小写[）)]\s*[¥￥]?\s*([0-9,]+\.\d{2})",
            r"[（(]小写[）)]\s*[¥￥]\s*([0-9,]+\.\d{2})",
        ],
        text,
    )
    invoice_number = first_match(
        [r"发票号码[：:]\s*([0-9]{8,24})"],
        text,
    )
    name_amount = first_match([r"-(\d+\.\d{2})元-"], path.name)
    company_mentioned = bool(company and company in re.sub(r"\s+", "", text))
    results.append(
        {
            "row": row_name,
            "fileName": path.name,
            "kind": "invoice" if is_invoice else "itinerary" if is_itinerary else "other",
            "invoiceNumber": invoice_number,
            "amount": float(amount.replace(",", "")) if amount else None,
            "fileNameAmount": float(name_amount) if name_amount else None,
            "buyer": buyer,
            "approvalCompanyMentioned": company_mentioned,
            "buyerMatchesApprovalCompany": (
                (
                    bool(buyer and company)
                    and re.sub(r"\s+", "", company) in re.sub(r"\s+", "", buyer)
                )
                or company_mentioned
            ),
            "textExtracted": bool(text.strip()),
        }
    )

output = root / "pdf-analysis.json"
output.write_text(
    json.dumps(
        {
            "businessId": business_id,
            "approvalCompany": company,
            "files": results,
        },
        ensure_ascii=False,
        indent=2,
    ),
    encoding="utf-8",
)

summary = {}
for item in results:
    row = summary.setdefault(
        item["row"],
        {
            "pdfs": 0,
            "invoices": 0,
            "itineraries": 0,
            "invoiceTotal": 0.0,
            "buyerMismatches": [],
            "unparsed": [],
        },
    )
    row["pdfs"] += 1
    if item["kind"] == "invoice":
        row["invoices"] += 1
        if item["amount"] is not None:
            row["invoiceTotal"] += item["amount"]
        if not item["buyerMatchesApprovalCompany"]:
            row["buyerMismatches"].append(item["fileName"])
    elif item["kind"] == "itinerary":
        row["itineraries"] += 1
    if not item["textExtracted"] or (item["kind"] == "invoice" and item["amount"] is None):
        row["unparsed"].append(item["fileName"])

for value in summary.values():
    value["invoiceTotal"] = round(value["invoiceTotal"], 2)

print(
    json.dumps(
        {
            "output": str(output),
            "approvalCompany": company,
            "rows": summary,
        },
        ensure_ascii=False,
        indent=2,
    )
)
