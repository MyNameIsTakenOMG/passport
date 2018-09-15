/**
 * Module dependencies.
 */

/* eslint-disable no-multi-assign */

const Passport = require('./authenticator');
const SessionStrategy = require('./strategies/session');


/**
 * Export default singleton.
 *
 * @api public
 */
exports = module.exports = new Passport();

/**
 * Expose constructors.
 */
exports.Passport = exports.Authenticator = Passport;
exports.Strategy = require('@passport-next/passport-strategy');

/**
 * Expose strategies.
 */
exports.strategies = {};
exports.strategies.SessionStrategy = SessionStrategy;
