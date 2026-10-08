import './styles.css';
import './ui/radio.css';
import './ui/account.css';
import { App } from './app';
import { installDebugHook } from './debug';

// Film grain overlay texture
const n = document.createElement('canvas');
n.width = n.height = 180;
const nx = n.getContext('2d');
if (nx) {
  const im = nx.createImageData(180, 180);
  for (let i = 0; i < im.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
    im.data[i + 3] = 255;
  }
  nx.putImageData(im, 0, 0);
  document.getElementById('grain')!.style.backgroundImage = `url(${n.toDataURL()})`;
}

const app = new App();
app.start();
installDebugHook(app);
