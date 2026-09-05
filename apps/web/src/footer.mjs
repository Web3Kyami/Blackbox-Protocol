const footer = document.querySelector(".site-footer");
const markup = `<footer class="protocol-footer shell">
  <div class="footer-brand"><span class="brand-mark"></span><span>BLACKBOX</span><p>Private capability infrastructure for Starknet.</p></div>
  <nav class="footer-product" aria-label="Product links"><a href="/studio/">Studio</a><a href="/docs">Docs</a><a href="/security">Security</a><a href="/use-cases">Use cases</a></nav>
  <div class="footer-social" aria-label="Social links">
    <a href="https://github.com/Web3Kyami/Blackbox-Protocol" rel="noreferrer" aria-label="BlackBox Protocol on GitHub" title="GitHub"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.5 2 2 6.6 2 12.2c0 4.4 2.9 8.1 6.8 9.4.5.1.7-.2.7-.5v-1.9c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.7-1.4-2.2-.2-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1.1.8-.2 1.7-.3 2.5-.3s1.7.1 2.5.3c2-1.4 2.8-1.1 2.8-1.1.5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.8-4.6 5 .4.3.7.9.7 1.8v2.7c0 .3.2.6.7.5 3.9-1.3 6.8-5 6.8-9.4C22 6.6 17.5 2 12 2Z"/></svg></a>
    <a href="https://x.com/Web3Kyami" rel="noreferrer" aria-label="Web3Kyami on X" title="X"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 15.6 6.5 22H3.4l7.3-8.4L3 2h6.5l4.4 5.8L18.9 2Zm-1.1 18h1.7L8.6 3.9H6.8L17.8 20Z"/></svg></a>
    <a href="mailto:web3kyami@gmail.com" aria-label="Email web3kyami@gmail.com" title="Email web3kyami@gmail.com"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v14H3V5Zm2 2v.3l7 5.2 7-5.2V7H5Zm14 10V9.8l-7 5.1-7-5.1V17h14Z"/></svg></a>
  </div>
</footer>`;
if (footer) footer.outerHTML = markup;
else document.body.insertAdjacentHTML("beforeend", markup);
