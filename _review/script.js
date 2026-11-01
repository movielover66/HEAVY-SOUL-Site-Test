// Page Load Animation Finish
window.addEventListener('DOMContentLoaded', () => {
    const loaderBar = document.getElementById('pageLoaderBar');
    if(loaderBar) {
        loaderBar.style.width = '100%';
        setTimeout(() => { 
            loaderBar.style.width = '0%'; 
        }, 300);
    }
});

// Universal Smooth Page Transition for all internal HTML links
document.addEventListener('click', function(e) {
    const link = e.target.closest('a');
    if (link && link.getAttribute('href') && link.getAttribute('href').endsWith('.html') && !link.getAttribute('target') && !link.getAttribute('onclick')) {
        e.preventDefault();
        const targetUrl = link.getAttribute('href');
        const loaderBar = document.getElementById('pageLoaderBar');
        if(loaderBar) loaderBar.style.width = '100%';
        document.body.classList.add('fade-out');
        setTimeout(() => {
            window.location.href = targetUrl;
        }, 350);
    }
});
