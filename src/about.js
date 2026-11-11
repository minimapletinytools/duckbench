import './about.css';

/** Add the About page without replacing the current editor or viewport. */
export function installAbout() {
  const button = document.createElement('button');
  button.id = 'about';
  button.textContent = '?';
  button.className = 'about-button';
  button.title = 'About Duckbench';
  button.setAttribute('aria-label', 'About Duckbench');
  button.setAttribute('aria-haspopup', 'dialog');
  document.querySelector('.shell-brand').append(button);

  const dialog = document.createElement('dialog');
  dialog.id = 'about-dialog';
  dialog.setAttribute('aria-labelledby', 'about-title');
  dialog.innerHTML = '<header><strong id="about-title">About & open-source credits</strong><button id="close-about" aria-label="Close About">Close</button></header><iframe title="About Duckbench and open-source licenses"></iframe>';
  document.body.append(dialog);
  const frame = dialog.querySelector('iframe');
  const url = new URL('about.html', document.baseURI).href;
  button.onclick = () => {
    frame.src = url;
    dialog.showModal();
    dialog.querySelector('button').focus();
  };
  dialog.querySelector('button').onclick = () => dialog.close();
  dialog.addEventListener('close', () => button.focus());
  return () => { dialog.remove(); button.remove(); };
}
