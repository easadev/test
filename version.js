import { inc as increment, parse } from 'npm:semver'
import { parseArgs } from 'jsr:@std/cli/parse-args'
import { simpleGit } from 'npm:simple-git'

/**
 * Log critical errors and then exit.
 * @param messages - One or more string messages to log before exiting.
 */
function logAndExit(...messages) {
  for (const m of messages) {
    console.log(m)
  }
  Deno.exit(1)
}

/**
 * Convenience method to run a command and get the output back synchronously.
 * @param cmd - The command to run (e.g. binary or path to invoke)
 * @param args - Optional arguments to pass along.
 * @param options - Optional options.
 * @returns - Deno.CommandOutput result
 */
function runCmd(
  cmd,
  args,
) {
  // For local testing purposes only.
  console.log(`Run: ${cmd} ${args?.join(' ')}`)
  return new Deno.Command(cmd, {
    args: args,
    stdout: 'piped',
    stderr: 'piped',
  }).outputSync()
}

/**
 * Convenience method to decode Deno.CommandOutput to strings.
 * @param c - The Deno.CommandOutput to parse to strings.
 * @returns An object with both stdout and stderr strings.
 */
function parseCommandOutput(c) {
  const stdout = (new TextDecoder().decode(c.stdout)).trim()
  const stderr = (new TextDecoder().decode(c.stderr)).trim()

  return {
    stdout,
    stderr,
  }
}

/**
 * Typeguard for Error
 * @param e - Value to check for Error
 */
function isError(e) {
  if (!(e instanceof Error)) {
    throw new Error(`Expected type to be Error. Got (${typeof e})`)
  }
}

function isDenoConfig(v) {
  if (typeof v !== 'object' || typeof v.version !== 'string') {
    throw new Error(`Expected type to be DenoConfig.  Missing version.`)
  }
}

if (import.meta.dirname === undefined) {
  logAndExit(
    'Could not determine current working path - import.meta.dirname is undefined',
  )
}

let currentVersion
let denoJson
let newVersion

try {
  const denoJsonText = await Deno.readTextFile(
    './deno.json',
  )
  denoJson = JSON.parse(denoJsonText)
  currentVersion = parse(denoJson.version)
  isDenoConfig(denoJson)
} catch (error) {
  isError(error)
  logAndExit(
    'Could not read existing deno.json to determine current version!',
    error.message,
  )
}

const git = simpleGit()
const args = parseArgs(Deno.args)

// Get next release version.
const releaseType = args.releaseType
if (!releaseType) {
  console.log(String(currentVersion))
  Deno.exit(0)
}

let isPromoteToProd = false

try {
  switch (releaseType) {
    case 'Increment RC':
      newVersion = increment(currentVersion, 'prerelease', 'rc')
      break
    case 'New Minor':
      newVersion = increment(currentVersion, 'preminor', 'rc')
      break
    case 'New Major':
      newVersion = increment(currentVersion, 'premajor', 'rc')
      break
    case 'Promote to Prod':
      isPromoteToProd = true
      newVersion = increment(currentVersion, 'minor')
      break

    default:
      throw new Error(`Invalid release type: ${releaseType}`)
  }
} catch (error) {
  isError(error)
  logAndExit(
    `Could not determine next version.  Current version (${currentVersion})`,
    error.message,
  )
}

console.log(`Current Version: ${currentVersion}`)
console.log(`New Version: ${newVersion}`)

if (!isPromoteToProd) {
  // Update deno.json
  Deno.writeTextFile(
    './deno.json',
    JSON.stringify(
      {
        ...denoJson,
        version: newVersion,
      },
      null,
      2,
    ),
  )

  const denoFmtOutput = runCmd('deno', ['fmt', 'deno.json'])

  if (!denoFmtOutput.success) {
    const { stdout, stderr } = parseCommandOutput(denoFmtOutput)
    logAndExit(`Could format deno.json`, stdout, stderr)
  }

  console.log(`Updated deno.json version to ${newVersion}.`)

  // Add deno.json to git commit
  try {
    await git.add('deno.json')
  } catch (error) {
    isError(error)
    logAndExit(`Could not add deno.json to git.`, error.message)
  }

  // Commit changes
  try {
    await git.commit(`Bump ${newVersion}`)
  } catch (error) {
    isError(error)
    logAndExit(`Could not commit to git.`, error.message)
  }
}

// Create Tag
try {
  await git.tag([
    '-a',
    `${newVersion}`,
    '-m',
    `${newVersion}`,
  ])
} catch (error) {
  isError(error)
  logAndExit(`Could not create tag.`, error.message)
}

Deno.exit(0)
