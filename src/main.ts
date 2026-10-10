import { mount } from 'svelte';
import './app.css';
import './forced-colors.css';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });
