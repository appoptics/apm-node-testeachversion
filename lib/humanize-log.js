#!/usr/bin/env node

/* eslint-disable no-console */

//
// read testeachversion's summary file and
// display a text representation of it.
//

const minimist = require('minimist')
const fs = require('fs')
const path = require('path')
const Grouper = require('sequence-grouper')

const jsonSummaryPattern = /(?:.*\/)*(.+-.+)-node-v(.+)-summary-(.+)\.json/

//
// define the CLI options and parse the command line
//

// Define CLI flags
const options = [{
  name: 'duplicates',
  alias: 'D',
  description: 'allow duplicate os-node-version matches',
  default: false,
  boolean: true,
}, {
  name: 'filter',
  alias: 'f',
  description: 'what to output: [p]asses, [f]ails, [s]kips, [t]railing-fails',
  default: 'p',
}, {
  name: 'output',
  alias: 'o',
  description: 'output file (only stdout for now)',
  default: 'stdout'
}, {
  name: 'template',
  alias: 't',
  description: 'fill in this template file (see code for details)',
  default: '',
}, {
  name: 'last',
  alias: 'l',
  description: 'output last version of each package tested',
  default: false,
  boolean: true,
}, {
  name: 'differences',
  alias: 'd',
  description: 'force writing templates',
  default: false,
  boolean: true,
}, {
  name: 'verbose',
  alias: 'v',
  description: 'write out intermediate data and information',
  default: false,
  boolean: true,
}, {
  name: 'fold-over-skips',
  alias: 's',
  description: 'merge ranges separated by skips',
  default: true,
  boolean: true,
}, {
  name: 'merge-duplicates',
  alias: 'm',
  description: 'similar to Object.assign(...) where ... is each summary file for a node-os combination',
  default: false,
  boolean: true,
}, {
  name: 'help',
  alias: 'h',
  description: 'output synopsis of options',
}]

// helper to create minimist options
function map (key, val) {
  const result = {}
  options.forEach(option => {
    result[option[key]] = option[val]
  })
  return result
}

// Parse process arguments
const argv = minimist(process.argv.slice(2), {
  default: map('name', 'default'),
  alias: map('alias', 'name'),
  boolean: options.reduce(
    function (accumulator, o) {
      if (o.boolean) {
        accumulator.push(o.name)
      }
      return accumulator
    },
    []
  )
})

// Show help text
if (argv.help) {
  console.log('Usage: humanize [args]...\n\nOptions [default value]:');

  options.forEach(o => {
    let alias = ''
    if (o.alias !== undefined) {
      alias = `-${o.alias}, `
    }
    let msg = padEnd(20, `  ${alias}--${o.name}`)
    msg += `   ${o.description}`
    const defaultValue = o.displayDefault || o.default;
    if (typeof defaultValue !== 'undefined') {
      msg += ` [${defaultValue}]`
    }
    console.log(msg)
  })
  process.exit();
}

if (argv._.length < 1) {
  console.error('usage:')
  console.error('    humanize: path [...path]')
  console.error('')
  console.error('Path may be repeated and each may be either a directory or a file')
  process.exit(1)
}

const filterMap = {
  p: 'pass',
  f: 'fail',
  s: 'skip',
  t: 'trailing-fails',
}
const filter = {};
argv.filter.split('').forEach(f => {
  if (f in filterMap) {
    filter[filterMap[f]] = true;
  }
})

function getFiles (fileOrDir) {
  const p = new Promise(function (resolve, reject) {
    fs.stat(fileOrDir, function (err, stats) {
      if (err) {
        reject(err)
        return
      }

      if (stats.isFile()) {
        resolve([fileOrDir])
        return
      }

      if (stats.isDirectory()) {
        fs.readdir(fileOrDir, function (err, files) {
          if (err) {
            reject(err)
          } else {
            resolve(files.map(f => path.join(fileOrDir, f)))
          }
        })
      }
    })
  })
  return p
}

//
// main program flow
//
Promise.all(argv._.map(spec => getFiles(spec))).then(results => {
  // turn the results into a single array
  let files = []
  results.forEach(r => files = files.concat(r))

  // select only the summary files
  const summaries = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const m = file.match(jsonSummaryPattern);
    if (m) {
      const summary = {
        file: file,
        os: m[1],
        nodeVersion: m[2],
        majorNodeVersion: m[2].split('.')[0],
        timestamp: m[3]
      }
      summaries.push(summary)
    }
  }
  return summaries
}).then(summaries => {
  // sort by node version
  summaries.sort((a, b) => {
    if (a.majorNodeVersion - b.majorNodeVersion) {
      return a.majorNodeVersion - b.majorNodeVersion
    }
    // node versions are the same, sort by OS
    if (a.os !== b.os) {
      return a.os < b.os ? -1 : 1
    }
    // node versions and OS are the same, sort by timestamp
    return a.timestamp < b.timestamp ? -1 : 1
  })
  return summaries
}).then(summaries => {
  // if duplicates are allowed don't do anything
  if (argv.duplicates || argv['merge-duplicates']) {
    return summaries
  }

  // because they are sorted this will only retain the latest timestamp
  // for duplicate os-node-version combinations.
  const dict = {}
  summaries.forEach(s => {
    dict[s.os + '-' + s.nodeVersion] = s
  })

  return Object.keys(dict).map(k => dict[k])
}).then(summaries => {
  return Promise.all(summaries.map(s => {
    return new Promise(function (resolve, reject) {
      // TODO BAM handle errors by resolving with no information but
      // flagging s.error = err and warning at end of the run.
      fs.readFile(s.file, 'utf8', function (err, contents) {
        if (err) {
          s.error = err;
          reject(err)
        } else {
          s.json = JSON.parse(contents)
          resolve(s)
        }
      })
    })
  }))
}).then(summaries => {
  // verify that it is a supported version of the summary file
  // TODO BAM continue handling errors by setting s.error = new Error(...)
  // or just delete it with warning?
  summaries.forEach(s => {
    if (!s.json.meta) {
      throw new Error(`missing meta key in ${s.file}`)
    }
    if (s.json.meta.summaryVersion !== 1) {
      throw new Error(`bad version ${s.json.meta.summaryVersion} in ${s.file}`)
    }
  })
  return summaries
}).then(summaries => {
  // group the files based on major node version
  const grouper = new Grouper();
  summaries.forEach(summary => grouper.addItem(summary, summary.majorNodeVersion))

  return grouper.groups
}).then(groups => {
  if (argv['merge-duplicates']) {
    // for each major node version count the number of files for each OS
    groups.forEach(g => {
      const counts = {}
      g.items.forEach(file => {
        if (!(file.os in counts)) {
          counts[file.os] = 0;
        }
        counts[file.os] += 1;
      })

      Object.keys(counts).forEach(k => {
        if (counts[k] < 2) {
          delete counts[k];
        }
      })

      // counts now only contains OS values with counts > 1. merge the results in
      // those files.
      let i = 0;
      while (i < g.count - 1) {
        if (g.items[i].os in counts && g.items[i].os === g.items[i + 1].os) {
          // save and delete the json property so it doesn't overwrite what we're keeping.
          const json = g.items[i + 1].json;
          delete g.items[i + 1].json;
          Object.assign(g.items[i], g.items[i + 1]);
          Object.assign(g.items[i].json.meta, json.meta);
          Object.assign(g.items[i].json.packages, json.packages);
          // delete the item just merged which has the same logical effect as
          // incrementing i.
          g.del(g.items[i + 1]);
        } else {
          i += 1;
        }
      }
    })

  }
  return groups;
}).then(groups => {
  let fd = process.stdout
  if (argv.output === 'stdout') {
    fd = process.stdout
  } else {
    // for now. maybe forever - user can use command line to
    // redirect output to a file.
    fd = process.stdout
  }

  // for each major node version
  groups.forEach(g => {

    if (argv.output === 'stdout') {
      const bars = '='.repeat(60);
      fd.write(`\n${bars}`)
      fd.write(`\nnode version ${g.key}`)
      fd.write(`\n${bars}`)
    }

    // for each OS
    g.items.forEach(i => {
      const packages = i.json.packages;
      const meta = i.json.meta;
      const linux = `${meta.linux.id} ${meta.linux.version_id}`;
      // this will be wrong if an OS/node run takes over 23 hours
      let et = new Date(meta.endTime - meta.startTime).toISOString();
      et = et.slice(11, -5);

      fd.write(`\n${meta.package} ${meta.version} commit ${meta.commit}`);
      fd.write(`\n node ${meta.node} on ${linux} at ${meta.timestamp}`);
      fd.write(`\n ${meta.package} branch: ${meta.branch} et: ${et}`);
      fd.write(`\n${meta.versions}`);
      fd.write('\npackages:\n')

      // for each package
      Object.keys(packages).forEach(p => {
        let line = `\n${p}`
        if (argv.last) line += ` (last tested: ${packages[p].latest})`
        fd.write(line)

        let ranges = packages[p].ranges
        // if foldOverSkips then pretend that skips in between supported
        // versions don't exist. if --filter contains skips that overrides
        if (argv['fold-over-skips'] && argv.filter.indexOf('s') < 0) {
          // first get rid of the skipped packages
          ranges = ranges.filter(r => r.key !== 'skip').map(r => Object.assign({}, r))

          // initialize with first results group
          const folded = [ranges.shift()]

          let i = 0
          while (i < ranges.length) {
            // if the keys match the previous entry merge them otherwise
            // create a new previous entry
            if (folded[folded.length - 1].key === ranges[i].key) {
              const previous = folded[folded.length - 1]
              previous.last = ranges[i].last
              previous.count += ranges[i].count
              previous._items = previous._items.concat(ranges[i]._items)
            } else {
              folded.push(ranges[i])
            }
            i += 1
          }
          // and replace the current ranges with the folded ranges
          packages[p].ranges = ranges = folded
        }

        // write the ranges for this package.
        let lastRange;
        ranges.forEach((r, ix) => {
          lastRange = r;

          // if only passes are desired then abbreviate the output
          if (argv.filter === 'p' && r.key === 'pass') {
            fd.write(`\n  ${range(r)}`);
            return;
          }
          // for trailing-fails show write only if it's the last range and the last
          // non-skipped range was a fail. return to prevent duplicated fail groups.
          if (filter['trailing-fails'] && ix === ranges.length - 1) {
            if (r.key === 'fail') {
              fd.write(`\n  ${r.key} ${range(r)} (${r.count})`);
              return;
            }
            if (r.key === 'skip' && lastRange.key === 'fail') {
              r = lastRange;
              fd.write(`\n  ${r.key} ${range(r)} (${r.count})`);
              return;
            }
          }
          // if asked for provide
          if (r.key in filter) {
            fd.write(`\n  ${r.key} ${range(r)} (${r.count})`)
          }
        })
      })

      fd.write('\n')
    })
  })
  // close if not stdout.
  if (argv.output !== 'stdout') {
    fs.closeSync(fd);
  }
  return groups
}).then(groups => {
  // if --template then use a template to output a single file
  // per tab.
  // TODO BAM it's beginning to look like the whole humanize-logs function
  // should become a separate facility. this really is pushing the limits of
  // keeping this logically unrelated piece of code (shares understanding of
  // summary file output format with testeachversion) in the same repository.
  if (!argv.template) {
    process.exit(0)
  }

  const p = new Promise(function (resolve, reject) {
    fs.readFile(argv.template, 'utf8', function (err, data) {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })

  return p.then(data => {
    return {groups, template: data}
  })
}).then(r => {
  // build a dictionary of the range text for each package with parenthesized
  // (os: ranges) appended when the ranges differ across those OSes tested.
  const {groups} = r;

  // for now hardcode this.
  // TODO BAM need better solution/setup at start.
  const fd = process.stdout;

  const supported = {}

  // for each major node version
  groups.forEach(g => {
    const nodeVersion = g.key;
    supported[nodeVersion] = {}
    // find ubuntu and set it as base for other oses to compare against
    // TODO BAM allow base to be configurable
    let base
    const others = [];

    g.items.forEach(os => {
      if (os.json.meta.linux.id === 'ubuntu') {
        base = os
      } else {
        others.push(os)
      }
    })

    if (!base) {
      throw new Error('Cannot find base linux version (ubuntu)')
    }

    // in case there are differences between OSes issue a warning at the end.
    const basename = base.json.meta.linux.id;
    const basePackages = base.json.packages;
    const differences = {};

    if (argv.v) {
      fd.write(`\nfor node version ${base.json.meta.node}:\n`)
      const othernames = others.map(o => o.json.meta.linux.id).join(', ')
      fd.write(`  base is ${basename} others are ${othernames}`)
    }

    Object.keys(basePackages).forEach(k => {
      const p = basePackages[k];

      // write the base os ranges for each range, r
      const text = p.ranges.reduce((result, r) => {
        if (r.key === 'pass') {
          result.push(`${range(r)}`)
        }
        return result
      }, []).join(', ')

      // store base os supported packages for this node version
      supported[nodeVersion][k] = text

      // for each package in the base compare against others.
      // N.B. this will not notice if an "other" os has a package
      // that is not in the base. the worst case for this is that
      // the supported packages will be understated for that os. if
      // important loop by index of keys and verify that they are
      // the same in each os the os test results.

      others.forEach(os => {
        const osPackage = os.json.packages[k];
        const meta = os.json.meta;
        if (!osPackage) {
          throw new Error(meta.linux.id + ' is missing pacakge ' + k)
        }

        // if the ranges differ for this os write those ranges too
        if (!equalRanges(basePackages[k], osPackage)) {
          // keep track of which packages there were differences in
          differences[k] = true

          const text = osPackage.ranges.reduce((result, r) => {
            if (r.key === 'pass') {
              result.push(`${range(r)}`)
            }
            return result
          }, []).join(', ')

          if (text) {
            supported[nodeVersion][k] += ' (' + meta.linux.id + ': ' + text + ')'
          }
        }
      })
      if (argv.v) {
        fd.write('\n' + k + ' ' + supported[nodeVersion][k])
      }
    })

    if (argv.v) {
      fd.write('\n')
    }

    // add supported by node version to the context
    r.supported = supported

    // warn if differences across OS results
    if (Object.keys(differences).length) {
      fd.write('\nWARNING - differences for node version ' + nodeVersion)
      Object.keys(differences).forEach(k => {
        fd.write('\n - ' + k + ' ' + supported[nodeVersion][k])
      })
      fd.write('\n')
    }

  })

  return r
}).then(r => {
  const {template, supported} = r
  r.output = {}

  // form is {{package:what}} where
  // - package is the package name
  // - what is versions (can be extended)
  //const re = /({{([-a-zA-Z_]+):([-a-zA-Z_]+)}})/g
  const re = /{{([-a-zA-Z0-9_]+:[-a-zA-Z0-9_]+)}}/g

  // split it into pieces and get all the substitution patterns.
  const tparts = template.split(re)

  // for each node version in supported insert the ranges into the template
  Object.keys(supported).forEach(nodeVersion => {
    const errors = []
    // copy the split template pieces
    const parts = tparts.map(i => i)

    // the template is split on the substitution pattern so every other
    // element is the pattern.
    for (let i = 1; i < parts.length; i += 2) {
      const [pkg, action] = parts[i].split(':')

      // TODO BAM invoke action-dependent function in future but for now the
      // only action is "versions".
      if (action !== 'versions') {
        parts[i] = 'N/A';
        errors.push('Unknown action: ' + action + ' for package: ' + pkg)
      } else if (!supported[nodeVersion][pkg]) {
        parts[i] = 'N/A'
        errors.push('No supported versions for ' + pkg)
      } else {
        parts[i] = supported[nodeVersion][pkg]
      }
    }

    r.output[nodeVersion] = {parts, errors}
  })
  return r
}).then(r => {
  //
  // write the filled-in templates here, one per node version. if
  // there are errors for a given version then use a .err extension
  // instead of .txt so it won't automatically overwrite existing content.
  //
  const output = r.output

  // one promise for each file written. resolved when done.
  const done = []
  const options = {
    flags: 'w',
    defaultEncoding: 'utf8',
    mode: 0o664
  }

  Object.keys(output).forEach(nodeVersion => {
    const {parts, errors} = output[nodeVersion]

    const p = new Promise(function (resolve, reject) {
      const filename = 'nodejs' + nodeVersion + (errors.length ? '.err' : '.txt');
      const f = fs.createWriteStream(filename, options)
      let i = 0

      // call writeFile when the stream is writable
      function writeFile () {
        while (f.write(parts[i])) {
          if (++i >= parts.length) {
            let lastChunk
            if (errors.length) {
              lastChunk = '\nErrors:\n' + errors.join('\n') + '\n'
            }
            f.end(lastChunk)
            break
          }
        }
      }

      // resolve promise when finished
      function finishFile () {
        resolve(nodeVersion)
      }

      function error (e) {
        reject(e)
      }

      f.on('error', error)
      f.on('finish', finishFile)
      f.on('drain', writeFile)

      // jump start the writer.
      f.emit('drain')
    })

    done.push(p)
  })

  return Promise.all(done)
}).then(r => {
  console.log(r)

}).catch(e => {
  console.error(e)
})

//
// helpers
//

function range (r) {
  return r.first === r.last ? r.first : r.first + '-' + r.last
}

// compare the ranges for two of the same package
function equalRanges (p1, p2) {
  if (p1.ranges.length !== p2.ranges.length) {
    return false
  }

  for (let i = 0; i < p1.ranges.length; i++) {
    if (!equalRange(p1.ranges[i], p2.ranges[i])) {
      return false
    }
  }
  return true
}

// compare a single range against another
function equalRange (r1, r2) {
  if (r1.count !== r2.count
    || r1.key !== r2.key
    || r1.first !== r2.first
    || r1.last !== r2.last) {
    return false
  }
  // the easy checks are done must compare arrays now but there
  // are only simple values, so no need for recursion.
  for (let i = 0; i < r1._items.length; i++) {
    if (r1._items[i] !== r2._items[i]) {
      return false
    }
  }
  return true
}

function padEnd (n, msg) {
  let len = n - msg.length + 1
  if (len < 0) {
    len = 0
  }
  return msg + ' '.repeat(len)
}
