import { render } from 'preact';
import { App } from './App';
import { init } from './storage';
import './style.css';

init().then(() => render(<App />, document.getElementById('app')!));
