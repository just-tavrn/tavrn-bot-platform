// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { MEMBER, OWNER, ROLE } from "../../fake-bot";
import moderation from "../moderation";
import { setup } from "../../test-utils";
import custom, { render } from "./index";

const cmd = (name: string, extra = {}) => ({ name, description: "d", response: "Hi {user}, this is {room} ({count})", ephemeral: false, roles: [], ...extra });

describe("custom commands", () => {
  it("fills the placeholders", () => {
    expect(render({ response: "Hi {user} in {room}, {count} here" }, { user: "a@b", room: "R", count: 3 })).toBe("Hi @a@b in R, 3 here");
  });

  it("announces the names without colliding with module commands and answers per room", async () => {
    const t = setup([moderation, custom]);
    const { warnings } = await t.configure("custom-commands", { commands: [cmd("rules"), cmd("ban"), cmd("Bad Name")] });
    expect(warnings[0]).toContain("Bad Name");
    const names = t.platform.commandSet().map((d) => d.name);
    expect(names.filter((n) => n === "ban")).toHaveLength(1);
    expect(names).toContain("rules");
    expect((await t.fake.invoke("rules", {}, MEMBER)).text).toBe(`Hi @${MEMBER.user}, this is Fake room (2)`);
    expect((await t.fake.invoke("cmd", { name: "rules" }, MEMBER)).text).toContain("Hi @");
    expect((await t.fake.invoke("cmd", { name: "nothing" }, MEMBER)).text).toContain("not set up");
  });

  it("limits a command to roles", async () => {
    const t = setup([custom]);
    await t.configure("custom-commands", { commands: [cmd("secret", { roles: [ROLE.mod], ephemeral: true })] });
    t.platform.commandSet();
    expect((await t.fake.invoke("secret", {}, MEMBER)).text).toBe("You may not use this command.");
    expect((await t.fake.invoke("secret", {}, OWNER)).answers[0]?.type).toBe("ephemeral");
  });
});
