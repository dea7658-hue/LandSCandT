import { mount } from "svelte";
import App from "./App.svelte";
import "./style.css";
mount(App, { target: document.getElementById("app")! });
if ("serviceWorker" in navigator && import.meta.env.PROD)
  navigator.serviceWorker.register("/sw.js");
