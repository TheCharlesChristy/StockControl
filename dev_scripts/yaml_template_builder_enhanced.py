#!/usr/bin/env python3
"""
Enhanced YAML Dependency-Based Template Builder
Implements component resolution, asset management, caching, and component variable support
"""

import yaml
import requests
import re
import json
import asyncio
import aiohttp
from pathlib import Path
from typing import Dict, Any, Optional, Union, List, Set, Tuple
import time
from urllib.parse import urljoin, urlparse
from dataclasses import dataclass, field
from bs4 import BeautifulSoup
import hashlib

@dataclass
class ComponentRef:
    """Represents a component reference with different resolution methods"""
    path: Optional[str] = None
    component_group: Optional[str] = None
    component_name: Optional[str] = None
    url: Optional[str] = None
    variables: Dict[str, Any] = field(default_factory=dict)
    
    @classmethod
    def from_yaml_value(cls, key: str, value: Union[str, Dict[str, Any]]) -> 'ComponentRef':
        """Create ComponentRef from YAML value"""
        if isinstance(value, str):
            if value.startswith(('http://', 'https://')):
                return cls(url=value)
            else:
                return cls(path=value)
        elif isinstance(value, dict):
            # Extract variables if they exist
            variables = value.get('variables', {})
            
            return cls(
                component_group=value.get('component_group'),
                component_name=value.get('component_name'),
                url=value.get('url'),
                path=value.get('path'),
                variables=variables
            )
        else:
            raise ValueError(f"Invalid component reference format for {key}: {value}")

@dataclass
class Asset:
    """Represents a CSS or JS asset"""
    type: str  # 'css' or 'js'
    src: str
    is_global: bool = False
    content: Optional[str] = None
    attributes: Dict[str, str] = field(default_factory=dict)

@dataclass
class BuildContext:
    """Context for building templates"""
    template_path: Path
    base_path: Path
    assets: List[Asset] = field(default_factory=list)
    processed_components: Set[str] = field(default_factory=set)
    component_cache: Dict[str, str] = field(default_factory=dict)
    data_cache: Dict[str, Any] = field(default_factory=dict)

class YAMLTemplateBuilder:
    """Enhanced template builder with component resolution and asset management"""
    
    def __init__(self, base_path: str = "src/frontend", use_cache: bool = True, timeout: int = 30):
        self.base_path = Path(base_path)
        self.use_cache = use_cache
        self.timeout = timeout
        self.template_pattern = re.compile(r'\{\{([^}]+)\}\}')
        
        # Enhanced caches
        self._file_cache = {}
        self._file_times = {}
        self._url_cache = {}
        self._url_cache_times = {}
        self._component_cache = {}
        self._asset_cache = {}
        self.cache_duration = 300  # 5 minutes for URL cache
        
        # Asset tracking
        self._global_assets = {'css': set(), 'js': set()}
        self._load_global_assets()
    
    def _load_global_assets(self):
        """Load and cache global asset references"""
        globals_css = self.base_path / "css" / "globals.css"
        globals_js = self.base_path / "js" / "globals.js"
        
        if globals_css.exists():
            self._global_assets['css'].add("/css/globals.css")
        if globals_js.exists():
            self._global_assets['js'].add("/js/globals.js")
    
    def _load_file_with_cache(self, file_path: Path) -> str:
        """Load file with caching based on modification time"""
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        
        file_str = str(file_path)
        current_mtime = file_path.stat().st_mtime
        
        if (self.use_cache and 
            file_str in self._file_cache and 
            self._file_times.get(file_str, 0) >= current_mtime):
            return self._file_cache[file_str]
        
        content = file_path.read_text(encoding='utf-8')
        
        if self.use_cache:
            self._file_cache[file_str] = content
            self._file_times[file_str] = current_mtime
        
        return content
    
    def _load_yaml_deps(self, template_path: Path) -> Dict[str, Any]:
        """Load YAML dependencies file based on project structure"""
        path_parts = template_path.parts
        
        deps_file = None
        if 'pages' in path_parts:
            # For pages: src/frontend/pages/PageName/html/PageName.html
            # YAML is at: src/frontend/pages/PageName/PageName.yaml
            page_idx = path_parts.index('pages')
            if page_idx + 1 < len(path_parts):
                page_name = path_parts[page_idx + 1]
                page_dir = template_path.parents[1]  # Go up from html/ to PageName/
                deps_file = page_dir / f"{page_name}.yaml"
        elif 'components' in path_parts:
            # For components: src/frontend/components/Group/html/component.html
            # YAML is at: src/frontend/components/Group/yaml/component.yaml
            comp_idx = path_parts.index('components')
            if comp_idx + 2 < len(path_parts):
                group_name = path_parts[comp_idx + 1]
                component_name = template_path.stem
                component_dir = template_path.parents[1]  # Go up from html/ to Group/
                deps_file = component_dir / "yaml" / f"{component_name}.yaml"
        
        if not deps_file or not deps_file.exists():
            return {'components': {}, 'data_dependencies': {}, 'default_data': {}}
        
        try:
            deps_content = self._load_file_with_cache(deps_file)
            parsed = yaml.safe_load(deps_content) or {}
            return {
                'components': parsed.get('components', {}),
                'data_dependencies': parsed.get('data_dependencies', {}),
                'default_data': parsed.get('default_data', {})
            }
        except yaml.YAMLError as e:
            print(f"❌ Error parsing YAML deps file {deps_file}: {e}")
            return {'components': {}, 'data_dependencies': {}, 'default_data': {}}
    
    def _resolve_component_path(self, comp_ref: ComponentRef, context: BuildContext) -> Optional[Path]:
        """Resolve component reference to actual file path"""
        if comp_ref.path:
            # Method 1: Direct path
            if comp_ref.path.startswith('/'):
                return self.base_path / comp_ref.path.lstrip('/')
            else:
                return (context.template_path.parent / comp_ref.path).resolve()
        
        elif comp_ref.component_group and comp_ref.component_name:
            # Method 2: Group/name object
            return (self.base_path / "components" / comp_ref.component_group / 
                   "html" / f"{comp_ref.component_name}.html")
        
        return None
    
    def _extract_assets_from_html(self, html_content: str, base_url: str = "") -> Tuple[str, List[Asset]]:
        """Extract CSS and JS assets from HTML content and return cleaned HTML"""
        soup = BeautifulSoup(html_content, 'html.parser')
        assets = []
        
        # Extract CSS links
        for link in soup.find_all('link', {'rel': 'stylesheet'}):
            href = link.get('href', '')
            if href:
                is_global = 'globals.css' in href
                asset = Asset(
                    type='css',
                    src=href,
                    is_global=is_global,
                    attributes={k: v for k, v in link.attrs.items() if k != 'href'}
                )
                assets.append(asset)
                link.decompose()  # Remove from HTML
        
        # Extract JS scripts
        for script in soup.find_all('script', {'src': True}):
            src = script.get('src', '')
            if src:
                is_global = 'globals.js' in src
                asset = Asset(
                    type='js',
                    src=src,
                    is_global=is_global,
                    attributes={k: v for k, v in script.attrs.items() if k != 'src'}
                )
                assets.append(asset)
                script.decompose()  # Remove from HTML
        
        return str(soup), assets
    
    def _deduplicate_assets(self, assets: List[Asset]) -> List[Asset]:
        """Remove duplicate assets and sort by priority (globals first)"""
        seen = set()
        unique_assets = []
        
        # Sort: globals first, then by type (CSS before JS), then by source
        sorted_assets = sorted(assets, key=lambda a: (
            not a.is_global,  # globals first (False < True)
            a.type != 'css',  # CSS before JS
            a.src
        ))
        
        for asset in sorted_assets:
            asset_key = (asset.type, asset.src)
            if asset_key not in seen:
                seen.add(asset_key)
                unique_assets.append(asset)
        
        return unique_assets
    
    def _inject_assets_into_html(self, html_content: str, assets: List[Asset]) -> str:
        """Inject assets into appropriate locations in HTML"""
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Find or create head and body
        head = soup.find('head')
        if not head:
            head = soup.new_tag('head')
            if soup.html:
                soup.html.insert(0, head)
            else:
                soup.insert(0, head)
        
        body = soup.find('body')
        if not body:
            body = soup.new_tag('body')
            soup.append(body)
        
        # Inject CSS into head
        css_assets = [a for a in assets if a.type == 'css']
        for asset in css_assets:
            link = soup.new_tag('link', rel='stylesheet', href=asset.src)
            for k, v in asset.attributes.items():
                link[k] = v
            head.append(link)
        
        # Inject JS before closing body
        js_assets = [a for a in assets if a.type == 'js']
        for asset in js_assets:
            script = soup.new_tag('script', src=asset.src)
            for k, v in asset.attributes.items():
                script[k] = v
            body.append(script)
        
        return str(soup)
    
    def _fetch_url_with_cache(self, url: str) -> str:
        """Fetch URL content with caching"""
        current_time = time.time()
        
        if (self.use_cache and 
            url in self._url_cache and 
            current_time - self._url_cache_times.get(url, 0) < self.cache_duration):
            return self._url_cache[url]
        
        try:
            print(f"🌐 Fetching: {url}")
            response = requests.get(url, timeout=self.timeout)
            response.raise_for_status()
            content = response.text
            
            if self.use_cache:
                self._url_cache[url] = content
                self._url_cache_times[url] = current_time
            
            return content
        except requests.RequestException as e:
            print(f"❌ Error fetching {url}: {e}")
            return f"<!-- Error loading {url}: {e} -->"
    
    def _fetch_data_with_cache(self, url: str) -> Any:
        """Fetch JSON data from URL with caching"""
        current_time = time.time()
        cache_key = f"data:{url}"
        
        if (self.use_cache and 
            cache_key in self._url_cache and 
            current_time - self._url_cache_times.get(cache_key, 0) < self.cache_duration):
            return self._url_cache[cache_key]
        
        try:
            print(f"📊 Fetching data: {url}")
            response = requests.get(url, timeout=self.timeout)
            response.raise_for_status()
            data = response.json()
            
            if self.use_cache:
                self._url_cache[cache_key] = data
                self._url_cache_times[cache_key] = current_time
            
            return data
        except requests.RequestException as e:
            print(f"❌ Error fetching data from {url}: {e}")
            return {}
        except json.JSONDecodeError as e:
            print(f"❌ Error parsing JSON from {url}: {e}")
            return {}
    
    def _build_component_tree(self, comp_ref: ComponentRef, comp_name: str, context: BuildContext) -> str:
        """Recursively build component and its dependencies"""
        # Check for circular dependencies
        component_id = f"{comp_ref.component_group or 'unknown'}/{comp_ref.component_name or comp_name}"
        if component_id in context.processed_components:
            print(f"⚠️  Circular dependency detected: {component_id}")
            return f"<!-- Circular dependency: {component_id} -->"
        
        context.processed_components.add(component_id)
        
        try:
            # Resolve component content
            if comp_ref.url:
                # Method 3: Remote URL
                component_content = self._fetch_url_with_cache(comp_ref.url)
            else:
                # Local component
                comp_path = self._resolve_component_path(comp_ref, context)
                if not comp_path or not comp_path.exists():
                    print(f"⚠️  Component file not found: {comp_path}")
                    return f"<!-- Component not found: {comp_name} -->"
                
                component_content = self._load_file_with_cache(comp_path)
                
                # Load component's own dependencies
                comp_deps = self._load_yaml_deps(comp_path)
                if comp_deps.get('components'):
                    print(f"📦 Processing sub-components for {comp_name}: {list(comp_deps['components'].keys())}")
                    
                    # Create new context for component
                    comp_context = BuildContext(
                        template_path=comp_path,
                        base_path=context.base_path,
                        assets=context.assets,
                        processed_components=context.processed_components.copy(),
                        component_cache=context.component_cache,
                        data_cache=context.data_cache
                    )
                    
                    # Build sub-components
                    sub_component_data = {}
                    for sub_name, sub_value in comp_deps['components'].items():
                        sub_ref = ComponentRef.from_yaml_value(sub_name, sub_value)
                        sub_component_data[sub_name] = self._build_component_tree(sub_ref, sub_name, comp_context)
                    
                    # Fetch component's data dependencies
                    for dep_name, api_url in comp_deps.get('data_dependencies', {}).items():
                        if api_url not in context.data_cache:
                            context.data_cache[api_url] = self._fetch_data_with_cache(api_url)
                        
                        data = context.data_cache[api_url]
                        if isinstance(data, dict):
                            sub_component_data.update(data)
                            sub_component_data[dep_name] = data
                        else:
                            sub_component_data[dep_name] = data
                    
                    # Add default data from component's YAML
                    sub_component_data.update(comp_deps.get('default_data', {}))
                    
                    # IMPORTANT: Add variables passed to this component (highest priority)
                    if comp_ref.variables:
                        print(f"📝 Passing variables to {comp_name}: {comp_ref.variables}")
                        sub_component_data.update(comp_ref.variables)
                    
                    # Replace placeholders in component
                    component_content = self._replace_placeholders(component_content, sub_component_data)
                else:
                    # Component has no sub-dependencies, but may still need variables
                    if comp_ref.variables:
                        print(f"📝 Passing variables to {comp_name}: {comp_ref.variables}")
                        # Create minimal data context with just the passed variables
                        component_data = {
                            **comp_deps.get('default_data', {}),
                            **comp_ref.variables
                        }
                        component_content = self._replace_placeholders(component_content, component_data)
            
            # Extract assets from component
            cleaned_content, component_assets = self._extract_assets_from_html(component_content)
            context.assets.extend(component_assets)
            
            return cleaned_content
            
        except Exception as e:
            print(f"❌ Error building component {comp_name}: {e}")
            return f"<!-- Error building component {comp_name}: {e} -->"
        finally:
            context.processed_components.discard(component_id)
    
    def build_template_sync(self, template_path: Union[str, Path], extra_data: Dict[str, Any] = None) -> str:
        """Build template synchronously with enhanced features"""
        if extra_data is None:
            extra_data = {}
        
        full_path = self.base_path / template_path if not Path(template_path).is_absolute() else Path(template_path)
        
        # Create build context
        context = BuildContext(
            template_path=full_path,
            base_path=self.base_path
        )
        
        # Load template content
        template_content = self._load_file_with_cache(full_path)
        
        # Load dependencies
        deps = self._load_yaml_deps(full_path)
        
        print(f"🔧 Building template: {template_path}")
        if deps.get('components'):
            print(f"📦 Components: {list(deps['components'].keys())}")
        if deps.get('data_dependencies'):
            print(f"📊 Data dependencies: {list(deps['data_dependencies'].keys())}")
        
        # Build components with dependency resolution
        component_data = {}
        for component_name, component_value in deps.get('components', {}).items():
            comp_ref = ComponentRef.from_yaml_value(component_name, component_value)
            component_data[component_name] = self._build_component_tree(comp_ref, component_name, context)
        
        # Fetch data dependencies
        api_data = {}
        for dep_name, api_url in deps.get('data_dependencies', {}).items():
            if api_url not in context.data_cache:
                context.data_cache[api_url] = self._fetch_data_with_cache(api_url)
            
            data = context.data_cache[api_url]
            if isinstance(data, dict):
                api_data.update(data)  # Flatten
                api_data[dep_name] = data  # Also nest for specific access
            else:
                api_data[dep_name] = data
        
        # Combine all data
        all_data = {
            **deps.get('default_data', {}),
            **component_data, 
            **api_data, 
            **extra_data
        }
        
        # Replace placeholders in main template
        built_content = self._replace_placeholders(template_content, all_data)
        
        # Extract assets from main template
        built_content, template_assets = self._extract_assets_from_html(built_content)
        context.assets.extend(template_assets)
        
        # Deduplicate and organize assets
        unique_assets = self._deduplicate_assets(context.assets)
        
        # Inject assets back into HTML
        final_content = self._inject_assets_into_html(built_content, unique_assets)
        
        print(f"✅ Template built with {len(unique_assets)} assets ({len([a for a in unique_assets if a.type == 'css'])} CSS, {len([a for a in unique_assets if a.type == 'js'])} JS)")
        
        return final_content
    
    def _replace_placeholders(self, template: str, data: Dict[str, Any]) -> str:
        """Replace {{placeholder}} with data, supporting nested keys"""
        def replace_func(match):
            key = match.group(1).strip()
            
            # Handle nested keys like {{user.name}}
            if '.' in key:
                try:
                    keys = key.split('.')
                    value = data
                    for k in keys:
                        value = value[k]
                    return str(value)
                except (KeyError, TypeError, AttributeError):
                    return match.group(0)  # Return original if not found
            else:
                return str(data.get(key, match.group(0)))
        
        return self.template_pattern.sub(replace_func, template)
    
    def clear_cache(self):
        """Clear all caches"""
        self._file_cache.clear()
        self._file_times.clear()
        self._url_cache.clear()
        self._url_cache_times.clear()
        self._component_cache.clear()
        self._asset_cache.clear()
    
    def get_cache_stats(self) -> Dict[str, Any]:
        """Get detailed cache statistics"""
        return {
            'file_cache_size': len(self._file_cache),
            'url_cache_size': len(self._url_cache),
            'component_cache_size': len(self._component_cache),
            'asset_cache_size': len(self._asset_cache),
            'cache_enabled': self.use_cache,
            'cached_files': list(self._file_cache.keys()),
            'cached_urls': [url for url in self._url_cache.keys() if not url.startswith('data:')],
            'global_assets': dict(self._global_assets)
        }
    
    def detect_circular_dependencies(self, template_path: Union[str, Path]) -> List[str]:
        """Detect circular dependencies in component tree"""
        # TODO: Implement circular dependency detection
        return []

# Async methods for better performance
class AsyncYAMLTemplateBuilder(YAMLTemplateBuilder):
    """Async version of template builder for better performance"""
    
    async def _fetch_url_async(self, session: aiohttp.ClientSession, url: str) -> str:
        """Async fetch URL content"""
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=self.timeout)) as response:
                response.raise_for_status()
                return await response.text()
        except Exception as e:
            print(f"❌ Error fetching {url}: {e}")
            return f"<!-- Error loading {url}: {e} -->"
    
    async def _fetch_data_async(self, session: aiohttp.ClientSession, url: str) -> Any:
        """Async fetch JSON data"""
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=self.timeout)) as response:
                response.raise_for_status()
                return await response.json()
        except Exception as e:
            print(f"❌ Error fetching data from {url}: {e}")
            return {}
    
    async def build_template_async(self, template_path: Union[str, Path], extra_data: Dict[str, Any] = None) -> str:
        """Build template asynchronously for better performance with multiple API calls"""
        if extra_data is None:
            extra_data = {}
        
        full_path = self.base_path / template_path if not Path(template_path).is_absolute() else Path(template_path)
        
        # Load template and dependencies (synchronous file operations)
        template_content = self._load_file_with_cache(full_path)
        deps = self._load_yaml_deps(full_path)
        
        print(f"🔧 Building template async: {template_path}")
        
        # Create build context
        context = BuildContext(
            template_path=full_path,
            base_path=self.base_path
        )
        
        async with aiohttp.ClientSession() as session:
            # Collect all async tasks
            tasks = []
            task_info = []
            
            # Prepare component fetch tasks for remote URLs
            for comp_name, comp_value in deps.get('components', {}).items():
                comp_ref = ComponentRef.from_yaml_value(comp_name, comp_value)
                if comp_ref.url:
                    tasks.append(self._fetch_url_async(session, comp_ref.url))
                    task_info.append(('component', comp_name))
            
            # Prepare data fetch tasks
            for dep_name, api_url in deps.get('data_dependencies', {}).items():
                tasks.append(self._fetch_data_async(session, api_url))
                task_info.append(('data', dep_name))
            
            # Execute all async tasks
            if tasks:
                results = await asyncio.gather(*tasks, return_exceptions=True)
                
                # Process results
                for i, (task_type, task_name) in enumerate(task_info):
                    result = results[i]
                    if isinstance(result, Exception):
                        print(f"❌ Error with {task_type} {task_name}: {result}")
                        if task_type == 'component':
                            extra_data[task_name] = f"<!-- Error loading component: {result} -->"
                        else:
                            extra_data[task_name] = {}
                    else:
                        if task_type == 'component':
                            extra_data[task_name] = result
                        else:
                            # Data dependency
                            if isinstance(result, dict):
                                extra_data.update(result)
                                extra_data[task_name] = result
                            else:
                                extra_data[task_name] = result
        
        # Build local components (synchronous)
        for comp_name, comp_value in deps.get('components', {}).items():
            if comp_name not in extra_data:  # Not already processed as remote URL
                comp_ref = ComponentRef.from_yaml_value(comp_name, comp_value)
                extra_data[comp_name] = self._build_component_tree(comp_ref, comp_name, context)
        
        # Add default data
        all_data = {**deps.get('default_data', {}), **extra_data}
        
        # Build final template
        built_content = self._replace_placeholders(template_content, all_data)
        
        # Handle assets
        built_content, template_assets = self._extract_assets_from_html(built_content)
        context.assets.extend(template_assets)
        unique_assets = self._deduplicate_assets(context.assets)
        final_content = self._inject_assets_into_html(built_content, unique_assets)
        
        return final_content


# Factory function for easy usage
def create_template_builder(base_path: str = "src/frontend", async_mode: bool = False, **kwargs) -> YAMLTemplateBuilder:
    """Factory function to create appropriate template builder"""
    if async_mode:
        return AsyncYAMLTemplateBuilder(base_path, **kwargs)
    else:
        return YAMLTemplateBuilder(base_path, **kwargs)