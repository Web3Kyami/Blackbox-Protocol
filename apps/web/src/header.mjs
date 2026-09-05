const currentPath = window.location.pathname.replace(/\/index\.html$/, "/");
const existingHeader = document.querySelector(".site-header");

if (existingHeader) {
  existingHeader.outerHTML = `
    <header class="site-header">
      <a class="brand" href="/" aria-label="BlackBox home"><span class="brand-mark" aria-hidden="true"></span><span>BLACKBOX</span></a>
      <button class="mobile-nav-toggle" type="button" aria-controls="primary-navigation" aria-expanded="false">Menu</button>
      <nav id="primary-navigation" aria-label="Primary navigation">
        <a href="/use-cases.html">Use cases</a>
        <a href="/docs.html">Docs</a>
        <a href="/security.html">Security</a>
        <a href="/issue.html">Issue a pass</a>
        <a class="mobile-only" href="/app.html">My capabilities</a>
        <a class="mobile-only" href="/studio/">Open Studio</a>
      </nav>
      <a class="button button-small button-primary header-cta" href="/studio/">Open Studio</a>
    </header>`;

  const header = document.querySelector(".site-header");
  const toggle = header.querySelector(".mobile-nav-toggle");
  const navigation = header.querySelector("#primary-navigation");
  const closeNavigation = () => {
    navigation.dataset.open = "false";
    toggle.setAttribute("aria-expanded", "false");
  };

  toggle.addEventListener("click", () => {
    const isOpen = navigation.dataset.open === "true";
    navigation.dataset.open = String(!isOpen);
    toggle.setAttribute("aria-expanded", String(!isOpen));
  });
  navigation.addEventListener("click", closeNavigation);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeNavigation();
  });

  for (const link of navigation.querySelectorAll("a")) {
    const linkPath = new URL(link.href).pathname;
    if (linkPath === currentPath) link.setAttribute("aria-current", "page");
  }
}
