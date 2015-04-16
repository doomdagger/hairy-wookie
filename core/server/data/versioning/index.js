/**
 * # Database versioning
 * Get Set database version
 * Created by Li He on 2014/7/25.
 * Updated by Lu Wanbo on 2015/2/18
 */

var errors         = require('../../errors'),
    Models          = require('../../models'),
    defaultSettings = require('../default-settings'),

    initialVersion  = '000',
    defaultDatabaseVersion;



// ## Default Database Version
// The migration version number according to the hardcoded default settings
// This is the version the database should be at or migrated to
function getDefaultDatabaseVersion() {
    if (!defaultDatabaseVersion) {
        // This be the current version according to the software
        defaultDatabaseVersion = defaultSettings.core.databaseVersion.defaultValue;
    }

    return defaultDatabaseVersion;
}

// ## Database Current Version
// The migration version number according to the database
// This is what the database is currently at and may need to be updated
function getDatabaseVersion() {

    var Settings = Models.Settings;
    return Settings.findOneAsync({'key': 'databaseVersion'}).then(function (version) {
        var databaseVersion;

        if (!version) {
            errors.throwError('No Database version could be found, settings collection does not exist?');
        }

        if (isNaN(version.value)) {
            errors.throwError('Database version is not recognised');
        }
        databaseVersion = version.value;
        if (!databaseVersion || databaseVersion.length === 0) {
            // we didn't get a response we understood, assume initialVersion
            databaseVersion = initialVersion;
        }
        return databaseVersion;
    });
}

function setDatabaseVersion(options) {
    var Settings = Models.Settings;
    return Settings.updateAsync({'key': 'databaseVersion'}, {$set: {'value': getDefaultDatabaseVersion()}}, options);
}

module.exports = {
    getDefaultDatabaseVersion: getDefaultDatabaseVersion,
    getDatabaseVersion: getDatabaseVersion,
    setDatabaseVersion: setDatabaseVersion
};