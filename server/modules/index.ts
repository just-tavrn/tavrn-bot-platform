// SPDX-License-Identifier: Apache-2.0
/** The modules of the platform, in the order the dashboard shows them. Add a new module here. */
import type { Module } from "./types";
import automod from "./automod";
import customCommands from "./custom-commands";
import levels from "./levels";
import moderation from "./moderation";
import polls from "./polls";
import raidHelper from "./raid-helper";
import reactionRoles from "./reaction-roles";
import reminders from "./reminders";
import socialAlerts from "./social-alerts";
import starboard from "./starboard";
import welcome from "./welcome";

export const MODULES: Module<any>[] = [welcome, automod, moderation, levels, reactionRoles, customCommands, polls, socialAlerts, starboard, reminders, raidHelper];
