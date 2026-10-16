// SPDX-License-Identifier: Apache-2.0
import { render } from "preact";
import { App } from "./app";
import { loadSession } from "./api";
import { lang } from "./i18n";
import "./styles.css";

document.documentElement.lang = lang.value;
void loadSession();
render(<App />, document.getElementById("app")!);
