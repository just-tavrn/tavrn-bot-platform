// SPDX-License-Identifier: Apache-2.0
/** The modules of the platform, in the order the dashboard shows them. Add a new module here. */
import type { Module } from "./types";
import welcome from "./welcome";

export const MODULES: Module<any>[] = [welcome];
