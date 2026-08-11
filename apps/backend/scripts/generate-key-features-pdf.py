from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


ROOT = Path("/Users/pratikchoudhuri/Documents/Livey Tech PAM CRM")
IMG_DIR = ROOT / "tmp/pdfs/key-features"
OUT = ROOT / "output/pdf/livey-pam-crm-key-features.pdf"


PAGES = [
    {
        "subtitle": "Daily partner workspace",
        "blurb": "The screens a partner uses every day to track work and stay productive.",
        "items": [
            (
                IMG_DIR / "01-dashboard.png",
                "Dashboard",
                "Shows the live view of the workspace.",
                "Pulls live numbers into cards and charts.",
                "First stop after sign-in.",
            ),
            (
                IMG_DIR / "02-deals.png",
                "Deals",
                "Lets partners register and follow opportunities.",
                "Add deal details, then track status in one place.",
                "When a deal is ready to be logged.",
            ),
            (
                IMG_DIR / "03-pipeline.png",
                "Pipeline",
                "Shows every deal by stage.",
                "Move cards forward as work progresses.",
                "During weekly sales follow-up.",
            ),
            (
                IMG_DIR / "04-customers.png",
                "Customers",
                "Keeps each account and its health score visible.",
                "Store account details, notes, and next steps.",
                "When managing an existing customer.",
            ),
        ],
    },
    {
        "subtitle": "Operations and value",
        "blurb": "Tools that help partners measure performance and manage assets.",
        "items": [
            (
                IMG_DIR / "05-analytics.png",
                "Analytics",
                "Shows revenue, deal mix, and account health.",
                "Turns live portal data into simple charts.",
                "For quick reviews and monthly reporting.",
            ),
            (
                IMG_DIR / "06-rewards.png",
                "Rewards",
                "Shows points, tier status, and available rewards.",
                "Earn points from activity, then redeem them.",
                "When a partner wants to check benefits.",
            ),
            (
                IMG_DIR / "07-documents.png",
                "Documents",
                "Stores partner files in one secure library.",
                "Upload or open files without leaving the portal.",
                "Whenever paperwork needs to be reviewed.",
            ),
            (
                IMG_DIR / "08-settings.png",
                "Settings",
                "Handles exports and account security.",
                "Change password or download portal data.",
                "When a user updates access or needs a report.",
            ),
        ],
    },
    {
        "subtitle": "Communication and account",
        "blurb": "The places partners use to stay informed and keep their account current.",
        "items": [
            (
                IMG_DIR / "09-notifications.png",
                "Notifications",
                "Collects important alerts in one feed.",
                "Marks items read or leaves them unread.",
                "When a status changes or a task is waiting.",
            ),
            (
                IMG_DIR / "10-support.png",
                "Support",
                "Lets partners raise help tickets.",
                "Submit a request and track the reply.",
                "When a question or issue needs attention.",
            ),
            (
                IMG_DIR / "11-partner-profile.png",
                "Company Profile",
                "Summarizes the partner business and status.",
                "Shows documents, notes, and progress.",
                "When LIVEY reviews or checks the account.",
            ),
            (
                IMG_DIR / "12-team.png",
                "Team",
                "Manages who can work inside the company.",
                "Add users, assign roles, and pause access.",
                "When a teammate joins or changes job.",
            ),
        ],
    },
    {
        "subtitle": "Partner journey",
        "blurb": "The path from first registration to LIVEY review and approval.",
        "items": [
            (
                IMG_DIR / "13-onboarding.png",
                "Onboarding",
                "Collects company details and documents.",
                "Step through the form and submit for review.",
                "Right after a new partner signs up.",
            ),
            (
                IMG_DIR / "14-partner-approvals.png",
                "Partner Approvals",
                "Lets LIVEY review partner applications.",
                "Open the record, add notes, and approve.",
                "After onboarding is submitted.",
            ),
            (
                IMG_DIR / "15-deal-approvals.png",
                "Deal Approvals",
                "Flags deals that need extra review.",
                "Check the queue and approve or send back.",
                "For larger or sensitive opportunities.",
            ),
            (
                IMG_DIR / "16-users-roles.png",
                "Users & Roles",
                "Controls who can see and do what.",
                "Create people, assign a role, and save.",
                "When access needs to be set up fast.",
            ),
        ],
    },
    {
        "subtitle": "Super-admin controls",
        "blurb": "Back-office tools that keep pricing, rewards, and visibility aligned.",
        "items": [
            (
                IMG_DIR / "17-tiers-products.png",
                "Tiers & Products",
                "Manages what each tier can access.",
                "Edit tiers, products, and offer details.",
                "When the portfolio or pricing changes.",
            ),
            (
                IMG_DIR / "18-rewards-admin.png",
                "Rewards Admin",
                "Manages the reward catalog and redemptions.",
                "Approve requests and update reward items.",
                "When the rewards program is updated.",
            ),
            (
                IMG_DIR / "19-news-feed.png",
                "News Feed",
                "Publishes updates partners can read.",
                "Post a message, image, or product update.",
                "For launches, announcements, and reminders.",
            ),
            (
                IMG_DIR / "20-audit-logs.png",
                "Audit Logs",
                "Records important actions for review.",
                "Stores who did what and when.",
                "When LIVEY needs a full activity trail.",
            ),
        ],
    },
]


def draw_card(c: canvas.Canvas, x: float, y: float, w: float, h: float, item: tuple[str, str, str, str, str]) -> None:
    img_path, title, what_line, how_line, when_line = item

    c.setFillColor(colors.white)
    c.setStrokeColor(colors.HexColor("#dbe4f0"))
    c.roundRect(x, y, w, h, 12, stroke=1, fill=1)

    # Header text stays compact so the content beneath has enough space to breathe.
    c.setFillColor(colors.HexColor("#0f172a"))
    c.setFont("Helvetica-Bold", 11.5)
    c.drawString(x + 14, y + h - 18, title.upper())
    c.setFillColor(colors.HexColor("#64748b"))
    c.setFont("Helvetica", 8.0)
    c.drawString(x + 14, y + h - 30, what_line)

    # Screenshot area.
    img = ImageReader(str(img_path))
    iw, ih = img.getSize()
    max_w = w - 24
    max_h = h - 122
    scale = min(max_w / iw, max_h / ih)
    dw = iw * scale
    dh = ih * scale
    dx = x + (w - dw) / 2
    dy = y + 54 + (max_h - dh) / 2
    c.drawImage(img, dx, dy, dw, dh, preserveAspectRatio=True, anchor="c")

    # Wrapped text block. This is the root-cause fix for the overlap issue.
    body_style = ParagraphStyle(
        "Body",
        fontName="Helvetica",
        fontSize=7.7,
        leading=9.1,
        textColor=colors.HexColor("#334155"),
        spaceAfter=0,
        spaceBefore=0,
    )

    summary_box_h = 38
    summary_box_y = y + 10
    c.setFillColor(colors.HexColor("#f8fafc"))
    c.setStrokeColor(colors.HexColor("#e2e8f0"))
    c.roundRect(x + 10, summary_box_y, w - 20, summary_box_h, 8, stroke=1, fill=1)

    summary = Paragraph(
        f'<b>What it does:</b> {what_line}<br/>'
        f'<b>How it works:</b> {how_line}<br/>'
        f'<b>When used:</b> {when_line}',
        body_style,
    )
    summary_w, summary_h = summary.wrap(w - 30, summary_box_h - 6)
    summary.drawOn(c, x + 15, summary_box_y + (summary_box_h - summary_h) / 2)


def main() -> None:
    page_w, page_h = landscape(letter)
    margin_x = 28
    margin_top = 52
    margin_bottom = 24
    gap_x = 16
    gap_y = 16
    header_h = 34
    cols = 2
    rows = 2
    card_w = (page_w - 2 * margin_x - gap_x) / cols
    card_h = (page_h - margin_top - margin_bottom - header_h - gap_y) / rows

    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=landscape(letter))
    c.setTitle("LIVEY PAM CRM Key Features")

    for page_num, page in enumerate(PAGES, start=1):
        c.setFillColor(colors.HexColor("#f7f9fc"))
        c.rect(0, 0, page_w, page_h, fill=1, stroke=0)

        c.setFillColor(colors.HexColor("#0f172a"))
        c.setFont("Helvetica-Bold", 20)
        c.drawString(margin_x, page_h - 32, "LIVEY PAM CRM")
        c.setFillColor(colors.HexColor("#2563eb"))
        c.setFont("Helvetica-Bold", 12)
        c.drawRightString(page_w - margin_x, page_h - 31, page["subtitle"])
        c.setStrokeColor(colors.HexColor("#dbe4f0"))
        c.setLineWidth(1)
        c.line(margin_x, page_h - 40, page_w - margin_x, page_h - 40)
        c.setFillColor(colors.HexColor("#475569"))
        c.setFont("Helvetica", 10.5)
        c.drawString(margin_x, page_h - 53, page["blurb"])

        for idx, item in enumerate(page["items"]):
            col = idx % 2
            row = idx // 2
            x = margin_x + col * (card_w + gap_x)
            y = page_h - margin_top - header_h - (row + 1) * card_h - row * gap_y
            draw_card(c, x, y, card_w, card_h, item)

        c.setStrokeColor(colors.HexColor("#dbe4f0"))
        c.line(margin_x, 16, page_w - margin_x, 16)
        c.setFillColor(colors.HexColor("#64748b"))
        c.setFont("Helvetica", 8.8)
        c.drawString(margin_x, 6, "Short feature summary for a non-technical pitch.")
        c.drawRightString(page_w - margin_x, 6, f"Page {page_num} of {len(PAGES)}")
        c.showPage()

    c.save()
    print(OUT)


if __name__ == "__main__":
    main()
