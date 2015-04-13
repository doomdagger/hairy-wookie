// General entry point for all configuration data
//
// This file itself is a wrapper for the root level config.js file.
// All other files that need to reference config.js should use this file.

var path          = require('path'),
    Promise       = require('bluebird'),
    fs            = require('fs'),
    url           = require('url'),
    _             = require('lodash'),
    mongoose      = require('mongoose'),
    validator     = require('validator'),
    errors        = require('../errors'),
    //TODO: 我们需要一个工具模块生成url吗
    //configUrl     = require('./url'),
    packageInfo   = require('../../../package.json'),
    appRoot       = path.resolve(__dirname, '../../../'),
    corePath      = path.resolve(appRoot, 'core/'),
    testingEnvs   = ['testing'],
    defaultConfig = {};

function ConfigManager(config) {
    /**
     * Our internal true representation of our current config object.
     * @private
     * @type {Object}
     */
    this._config = {};

    //TODO: 如果我们为config模块增加了其他文件，请将功能统一并入此类下
    //this.urlFor = configUrl.urlFor;
    //this.urlPathForPost = configUrl.urlPathForPost;

    // If we're given an initial config object then we can set it.
    if (config && _.isObject(config)) {
        this.set(config);
    }
}

// Are we using sockets? Custom socket or the default?
ConfigManager.prototype.getSocket = function () {
    if (this._config.server.hasOwnProperty('socket')) {
        return _.isString(this._config.server.socket) ?
            this._config.server.socket :
            path.join(this._config.paths.contentPath, process.env.NODE_ENV + '.socket');
    }
    return false;
};

ConfigManager.prototype.init = function (rawConfig) {
    var self = this;

    // Cache the config.js object's environment
    // object so we can later refer to it.
    // Note: this is not the entirety of config.js,
    // just the object appropriate for this NODE_ENV
    self.set(rawConfig);

    return Promise.resolve(self._config);
};

function configureDriver() {

    // Let mongoose support Promise Style of Bluebird,
    // Look up the docs to find specific Data Access Method,
    // Trailing 'Async' at the name of Model Object and Model Instance
    Promise.promisifyAll(mongoose);
}

/**
 * Allows you to set the config object.
 * @param {Object} config Only accepts an object at the moment.
 */
ConfigManager.prototype.set = function (config) {
    var localPath = '',
        contentPath,
        subdir;

    // Merge passed in config object onto our existing config object.
    // We're using merge here as it doesn't assign `undefined` properties
    // onto our cached config object.  This allows us to only update our
    // local copy with properties that have been explicitly set.
    _.merge(this._config, config);

    // Protect against accessing a non-existant object.
    // This ensures there's always at least a paths object
    // because it's referenced in multiple places.
    this._config.paths = this._config.paths || {};

    // Parse local path location
    if (this._config.url) {
        localPath = url.parse(this._config.url).path;
        // Remove trailing slash
        if (localPath !== '/') {
            localPath = localPath.replace(/\/$/, '');
        }
    }

    subdir = localPath === '/' ? '' : localPath;

    // Allow contentPath to be over-written by passed in config object
    // Otherwise default to default content path location
    contentPath = this._config.paths.contentPath || path.resolve(appRoot, 'content');

    if (!mongoose.connection.db &&
        this._config.database &&
        this._config.database.mongodb &&
        this._config.database.mongodb.connection) {

        var connectionInfo = this._config.database.mongodb.connection,
            options = this._config.database.mongodb.options || {};

        configureDriver();

        mongoose.connect(connectionInfo.host,
            connectionInfo.database,
            connectionInfo.port,
            options);
    }

    _.merge(this._config, {
        database: {
            db: mongoose.connection.db
        },
        icollegeVersion: packageInfo.version,
        paths: {
            appRoot:          appRoot,
            subdir:           subdir,
            config:           this._config.paths.config || path.join(appRoot, 'config.js'),
            configExample:    path.join(appRoot, 'config.example.js'),
            corePath:         corePath,

            contentPath:      contentPath,
            imagesPath:       path.resolve(contentPath, 'images'),
            imagesRelPath:    'content/images',

            exportPath:       path.join(corePath, '/server/data/export/'),
            lang:             path.join(corePath, '/shared/lang/')
        },
        //TODO: 确定slugs的设计思路
        //slugs: {
        //    // Used by generateSlug to generate slugs for posts, tags, users, ..
        //    // reserved slugs are reserved but can be extended/removed by apps
        //    // protected slugs cannot be changed or removed
        //    reserved: ['admin', 'app', 'apps', 'archive', 'archives', 'categories', 'category', 'dashboard', 'feed', 'icollege-admin', 'login', 'logout', 'page', 'pages', 'post', 'posts', 'public', 'register', 'setup', 'signin', 'signout', 'signup', 'tag', 'tags', 'user', 'users', 'wp-admin', 'wp-login'],
        //    protected: ['icollege', 'rss']
        //},
        uploads: {
            // Used by the upload API to limit uploads to images
            extensions: ['.jpg', '.jpeg', '.gif', '.png', '.svg', '.svgz'],
            contentTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml']
        },
        deprecatedItems: ['mail.fromaddress']
    });

    //TODO: config模块的扩展模块如此设定依赖，依赖于this._config
    // Also pass config object to
    // configUrl object to maintain
    // clean dependency tree
    //configUrl.setConfig(this._config);

    // For now we're going to copy the current state of this._config
    // so it's directly accessible on the instance.
    // @TODO: perhaps not do this?  Put access of the config object behind a function?
    _.extend(this, this._config);
};

/**
 * Allows you to read the config object.
 * @return {Object} The config object.
 */
ConfigManager.prototype.get = function () {
    return this._config;
};

ConfigManager.prototype.load = function (configFilePath) {
    var self = this;

    self._config.paths.config = process.env.GHOST_CONFIG || configFilePath || self._config.paths.config;

    /* Check for config file and copy from config.example.js
     if one doesn't exist. After that, start the server. */
    return new Promise(function (resolve, reject) {
        fs.exists(self._config.paths.config, function (exists) {
            var pendingConfig;

            if (!exists) {
                pendingConfig = self.writeFile();
            }

            Promise.resolve(pendingConfig).then(function () {
                return self.validate();
            }).then(function (rawConfig) {
                resolve(self.init(rawConfig));
            }).catch(reject);
        });
    });
};

/* Check for config file and copy from config.example.js
 if one doesn't exist. After that, start the server. */
ConfigManager.prototype.writeFile = function () {
    var configPath = this._config.paths.config,
        configExamplePath = this._config.paths.configExample;

    return new Promise(function (resolve, reject) {
        fs.exists(configExamplePath, function checkTemplate(templateExists) {
            var read,
                write,
                error;

            if (!templateExists) {
                error = new Error('Could not locate a configuration file.');
                error.context = appRoot;
                error.help = 'Please check your deployment for config.js or config.example.js.';

                return reject(error);
            }

            // Copy config.example.js => config.js
            read = fs.createReadStream(configExamplePath);
            read.on('error', function (err) {
                errors.logError(new Error('Could not open config.example.js for read.'), appRoot, 'Please check your deployment for config.js or config.example.js.');

                reject(err);
            });

            write = fs.createWriteStream(configPath);
            write.on('error', function (err) {
                errors.logError(new Error('Could not open config.js for write.'), appRoot, 'Please check your deployment for config.js or config.example.js.');

                reject(err);
            });

            write.on('finish', resolve);

            read.pipe(write);
        });
    });
};

/**
 * Read config.js file from file system using node's require
 * @param  {String} envVal Which environment we're in.
 * @return {Object}        The config object.
 */
ConfigManager.prototype.readFile = function (envVal) {
    return require(this._config.paths.config)[envVal];
};

/**
 * Validates the config object has everything we want and in the form we want.
 * @return {Promise.<Object>} Returns a promise that resolves to the config object.
 */
ConfigManager.prototype.validate = function () {
    var envVal = process.env.NODE_ENV || undefined,
        hasHostAndPort,
        hasSocket,
        config,
        parsedUrl;

    try {
        config = this.readFile(envVal);
    }
    catch (e) {
        return Promise.reject(e);
    }

    // Check if we don't even have a config
    if (!config) {
        errors.logError(new Error('Cannot find the configuration for the current NODE_ENV'), 'NODE_ENV=' + envVal,
            'Ensure your config.js has a section for the current NODE_ENV value and is formatted properly.');

        return Promise.reject(new Error('Unable to load config for NODE_ENV=' + envVal));
    }

    // Check that our url is valid
    if (!validator.isURL(config.url, {protocols: ['http', 'https'], require_protocol: true})) {
        errors.logError(new Error('Your site url in config.js is invalid.'), config.url, 'Please make sure this is a valid url before restarting');

        return Promise.reject(new Error('invalid site url'));
    }

    parsedUrl = url.parse(config.url || 'invalid', false, true);

    if (/\/icollege(\/|$)/.test(parsedUrl.pathname)) {
        errors.logError(new Error('Your site url in config.js cannot contain a subdirectory called icollege.'), config.url, 'Please rename the subdirectory before restarting');

        return Promise.reject(new Error('icollege subdirectory not allowed'));
    }

    // Check that we have database values
    if (!config.database || !config.database.mongodb) {
        errors.logError(new Error('Your database configuration in config.js is invalid.'), JSON.stringify(config.database), 'Please make sure this is a valid mongodb database configuration');

        return Promise.reject(new Error('invalid database configuration'));
    }

    hasHostAndPort = config.server && !!config.server.host && !!config.server.port;
    hasSocket = config.server && !!config.server.socket;

    // Check for valid server host and port values
    if (!config.server || !(hasHostAndPort || hasSocket)) {
        errors.logError(new Error('Your server values (socket, or host and port) in config.js are invalid.'), JSON.stringify(config.server), 'Please provide them before restarting.');

        return Promise.reject(new Error('invalid server configuration'));
    }

    return Promise.resolve(config);
};

/**
 * Helper method for checking the state of a particular privacy flag
 * @param {String} privacyFlag The flag to check
 * @returns {boolean}
 */
ConfigManager.prototype.isPrivacyDisabled = function (privacyFlag) {
    if (!this.privacy) {
        return false;
    }

    if (this.privacy.useTinfoil === true) {
        return true;
    }

    return this.privacy[privacyFlag] === false;
};

/**
 * Check if any of the currently set config items are deprecated, and issues a warning.
 */
ConfigManager.prototype.checkDeprecated = function () {
    var self = this;
    _.each(this.deprecatedItems, function (property) {
        self.displayDeprecated(self, property.split('.'), []);
    });
};

ConfigManager.prototype.displayDeprecated = function (item, properties, address) {
    var self = this,
        property = properties.shift(),
        errorText,
        explanationText,
        helpText;

    address.push(property);

    if (item.hasOwnProperty(property)) {
        if (properties.length) {
            return self.displayDeprecated(item[property], properties, address);
        }
        errorText = 'The configuration property [' + address.join('.').bold + '] has been deprecated.';
        explanationText =  'This will be removed in a future version, please update your config.js file.';
        helpText = 'Please check https://42.96.195.83/guanggu/icollege/blob/master/config.example.js for the most up-to-date example.';
        errors.logWarn(errorText, explanationText, helpText);
    }
};

if (testingEnvs.indexOf(process.env.NODE_ENV) > -1) {
    defaultConfig  = require('../../../config.example')[process.env.NODE_ENV];
}

module.exports = new ConfigManager(defaultConfig);
