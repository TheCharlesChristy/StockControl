from pathlib import Path

# Get the base component html
with open(Path(__file__).parent / "BASE_COMPONENT_HTML.html", 'r') as f:
    base_component_html = f.read()

# Get the base component css
with open(Path(__file__).parent / "BASE_COMPONENT_CSS.css", 'r') as f:
    base_component_css = f.read()

# Get the base yaml configuration
with open(Path(__file__).parent / "BASE_YAML.yaml", 'r') as f:
    base_yaml = f.read()

COMPONENTS_DIR = Path(__file__).parent.parent / "src" / "frontend" / "components"
print(f"Components directory: {COMPONENTS_DIR}")

# Ask if the user want to create a new component or a new component group
group_or_component = input("Do you want to create a new component or a group, yes for component, no for group: ").strip().lower()
if group_or_component not in ['yes', 'no', "y", "n"]:
    print("Invalid input. Please enter 'yes' for component or 'no' for group.")
    exit(1)

# Determine the type of creation
if group_or_component in ['yes', 'y']:
    # Present the user with a numbered list of existing component groups
    existing_groups = [d.name for d in COMPONENTS_DIR.iterdir() if d.is_dir()]
    print("Existing component groups:")
    for i, group in enumerate(existing_groups, start=1):
        print(f"{i}. {group}")

    # Ask the user to select a group
    group_index = input("Select a group by number (or enter a new group name): ").strip()
    if group_index.isdigit() and 1 <= int(group_index) <= len(existing_groups):
        selected_group = existing_groups[int(group_index) - 1]
    else:
        selected_group = group_index

    # Create the new component directory
    group_path = COMPONENTS_DIR / selected_group

    group_path.mkdir(parents=True, exist_ok=True)

    # Create the css, js, and html and yaml directories
    (group_path / "css").mkdir(exist_ok=True)
    (group_path / "js").mkdir(exist_ok=True)
    (group_path / "html").mkdir(exist_ok=True)
    (group_path / "yaml").mkdir(exist_ok=True)

    # Ask for the component name
    component_name = input("Enter the name of the component: ").strip()
    if not component_name:
        print("Component name cannot be empty.")
        exit(1)

    # Create the component directory
    css_fname = f"{component_name}.css"
    (group_path / "css" / css_fname).touch()
    js_fname = f"{component_name}.js"
    (group_path / "js" / js_fname).touch()
    html_fname = f"{component_name}.html"
    (group_path / "html" / html_fname).touch()
    yaml_fname = f"{component_name}.yaml"
    (group_path / "yaml" / yaml_fname).touch()

    # Write the base YAML configuration to the YAML file
    with open(group_path / "yaml" / yaml_fname, 'w') as yaml_file:
        yaml_file.write(base_yaml.replace("{{component_name}}", component_name))

    # Add a basic template to the HTML file
    with open(group_path / "html" / html_fname, 'w') as html_file:
        html_file.write(base_component_html.replace("{{component_name}}", component_name).replace("{{component_group}}", selected_group))

    # Add a basic template to the CSS file
    with open(group_path / "css" / css_fname, 'w') as css_file:
        css_file.write(base_component_css.replace("{{component_name}}", component_name))

    print(f"Component '{component_name}' created in group '{selected_group}' with files: {css_fname}, {js_fname}, {html_fname}")
else:
    # Ask for the name of the new component group
    name = input("Enter the name of the new component group: ").strip()
    if not name:
        print("Component group name cannot be empty.")
        exit(1)
    # Create a new component group
    group_path = COMPONENTS_DIR / name
    group_path.mkdir(parents=True, exist_ok=True)

    # Create the css, js, and html directories
    (group_path / "css").mkdir(exist_ok=True)
    (group_path / "js").mkdir(exist_ok=True)
    (group_path / "html").mkdir(exist_ok=True)

    print(f"Component group '{name}' created with directories: css, js, html")



