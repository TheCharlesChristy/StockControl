function goto(path, options = {}) {
    // Validate path
    if (!path || typeof path !== 'string') {
        console.warn('Invalid path provided to goto()');
        return;
    }

    // Normalize path
    const normalizedPath = path.startsWith('/') ? path : '/' + path;
    
    // Check if it's the same page to avoid unnecessary navigation
    if (window.location.pathname === normalizedPath) {
        return;
    }

    // Add loading indicator
    if (options.showLoader !== false) {
        showPageLoader();
    }

    // Smooth transition with slight delay
    if (options.smooth !== false) {
        document.body.style.opacity = '0.8';
        setTimeout(() => {
            window.location.href = normalizedPath;
        }, 150);
    } else {
        window.location.href = normalizedPath;
    }
}

// Helper function for loading indicator
function showPageLoader() {
    if (document.getElementById('page-loader')) return;
    
    const loader = document.createElement('div');
    loader.id = 'page-loader';
    loader.innerHTML = '<div class="spinner"></div>';
    loader.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(255,255,255,0.8); z-index: 9999;
        display: flex; align-items: center; justify-content: center;
    `;
    
    const spinner = loader.querySelector('.spinner');
    spinner.style.cssText = `
        width: 40px; height: 40px; border: 4px solid #f3f3f3;
        border-top: 4px solid #3498db; border-radius: 50%;
        animation: spin 1s linear infinite;
    `;
    
    document.body.appendChild(loader);
}

// Add CSS animation for spinner
const style = document.createElement('style');
style.textContent = `
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
`;
document.head.appendChild(style);

// Utility functions for common navigation patterns
function goHome() {
    goto('/');
}

function goBack() {
    if (window.history.length > 1) {
        window.history.back();
    } else {
        goto('/');
    }
}

function refresh() {
    window.location.reload();
}

function isFromBackButton() {
    const navigation = window.performance.getEntriesByType('navigation')[0];
    return navigation && navigation.type === 'back_forward';
}

// Enhanced detection with event listener
let cameFromBackButton = false;

window.addEventListener('pageshow', function(event) {
    if (event.persisted || isFromBackButton()) {
        cameFromBackButton = true;
        refresh()
    }
});

window.addEventListener('popstate', function() {
    cameFromBackButton = true;
});

// Main function that combines detection methods
function detectedFromBackButton() {
    return cameFromBackButton || 
           isFromBackButton();
}

// Check on DOMContentLoaded and page load
window.addEventListener('DOMContentLoaded', function() {
    if (isFromBackButton()) {
        refresh()
    }
});

window.addEventListener('load', function() {
    if (detectedFromBackButton()) {
        refresh()
    }
});