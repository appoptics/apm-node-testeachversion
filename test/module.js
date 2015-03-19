var Module = require('../dist/')
var semver = require('semver')
var fs = require('fs')

describe('module', function () {
  var module
  var spec

  this.timeout(10000)

  before(function () {
    spec = {
      name: 'ap',
      task: 'echo "test"',
      range: '*'
    }

    module = new Module(spec, '0.2.0')
  })

  it('should discover satisfied versions', function () {
    return Module.matchingSpec(spec).then(function (versions) {
      versions.forEach(function (module) {
        module.name.should.equal(spec.name)
        semver.satisfies(module.version, spec.range).should.equal(true)
      })
    })
  })

  it('should discover satisfied versions from array range', function () {
    var possible = [
      '4.9.7',
      '4.9.8',
      '4.10.0',
      '4.10.1'
    ]

    var spec = {
      name: 'express',
      task: 'true',
      range: ['~4.9.7', '<= 4.10.1 >= 4.10.0']
    }

    return Module.matchingSpec(spec).then(function (versions) {
      versions.length.should.equal(possible.length)
      versions.forEach(function (module) {
        module.name.should.equal(spec.name)
        possible.should.containEql(module.version)
      })
    })
  })

  it('should uninstall', function () {
    return module.uninstall().then(function () {
      if (fs.existsSync('node_modules/' + spec.name)) {
        throw new Error(spec.name + ' should have been uninstalled')
      }
    })
  })

  it('should install', function () {
    return module.install().then(function () {
      var pkg = require('ap/package')
      pkg.version.should.equal('0.2.0')
    })
  })

  it('should test', function () {
    return module.test().then(function (res) {
      validateTest(spec, res)
    })
  })

  it('should test with install', function () {
    return module.testWithInstall().then(function (res) {
      validateTest(spec, res)
    })
  })

  it('should test with versions', function () {
    return Module.testWithVersions(spec).then(function (res) {
      validateVersionList(spec, res)
    })
  })

  it('should test with module list', function () {
    return Module.testAllWithVersions([spec,spec]).then(function (res) {
      validateModuleList(spec, res)
    })
  })

  it('should not fail to return result when failing a test', function () {
    var data = {
      name: 'ap',
      task: 'exit 1'
    }

    var mod = new Module(data, '0.2.0')

    return mod.testWithInstall().then(function (res) {
      res.name.should.equal(mod.name)
      res.task.should.equal(mod.task)
      res.passed.should.equal(false)
      res.result.should.equal('')
    })
  })

  //
  // Validators
  //

  function validateTest (spec, res) {
    res.name.should.equal(spec.name)
    res.task.should.equal(spec.task)
    res.passed.should.equal(true)
    res.result.should.equal('test\n')
  }

  function validateVersionList (spec, res) {
    res.should.be.instanceof(Array)
    res.forEach(function (res) {
      validateTest(spec, res)
    })
  }

  function validateModuleList (spec, res) {
    res.should.be.instanceof(Array)
    res.forEach(function (res) {
      validateVersionList(spec, res)
    })
  }
})
