"""Re-embed assets/voucher-template.docx into js/voucher-template-data.js.
Run this if you replace the Word template (logo/signature/styles)."""
import base64, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
b = base64.b64encode((root / "assets/voucher-template.docx").read_bytes()).decode()
(root / "js/voucher-template-data.js").write_text(
    "/* Auto-generated from assets/voucher-template.docx (Hexaware logo + Krishna signature). "
    "Regenerate with: python3 tools/embed_template.py */\n"
    f'window.VOUCHER_TEMPLATE_B64 = "{b}";\n')
print("Embedded", len(b), "chars")
