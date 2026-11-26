import { build, command, prepareShots } from "./cases.ts";

if (process.platform !== "linux") throw new Error("Run shot:linux in the Linux desktop container or on a Linux desktop");
const { directory, shots } = prepareShots("linux");
if (shots.length === 0) process.exit(0);

build("linux");
command("apps/linux/build/screenshots", [directory, ...shots.map(({ id, scheme }) => `${id}:${scheme}`)]);
