from pathlib import Path

# Load the base HTML template
with open(Path(__file__).parent / "BASE_PAGE_HTML.html", 'r') as f:
    base_page_html = f.read()

PAGES_DIR = Path(__file__).parent.parent / "src" / "frontend" / "pages"

# Ask the user for the page name
page_name = input("Enter the name of the page: ").strip()
if not page_name:
    print("Page name cannot be empty.")
    exit(1)

# Create the page directory
page_path = PAGES_DIR / page_name
page_path.mkdir(parents=True, exist_ok=True)

# Create the css, js, and html directories
css_dir = page_path / "css"
js_dir = page_path / "js"
html_dir = page_path / "html"
css_dir.mkdir(exist_ok=True)
js_dir.mkdir(exist_ok=True)
html_dir.mkdir(exist_ok=True)

# Create the main HTML file
html_file = html_dir / f"{page_name}.html"

# Add a basic template to the HTML file
with open(html_file, 'w') as file:
    file.write(base_page_html.replace("{{PAGE_NAME}}", page_name))

print(f"Page '{page_name}' created successfully at {html_file.resolve()}")

# Create the CSS and JS files
css_file = css_dir / f"{page_name}.css"
js_file = js_dir / f"{page_name}.js"

# Create empty CSS and JS files
css_file.touch()
js_file.touch()