import { render } from 'preact';
import { App } from './App';
import { browserLang, setLang } from './i18n';
import { init, loadPrefs } from './storage';
import './style.css';

// Before init: a new outline's sample content is written in this language.
setLang(loadPrefs().lang ?? browserLang());
init().then(() => render(<App />, document.getElementById('app')!));
