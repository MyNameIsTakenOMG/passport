/* eslint-disable no-shadow */
'use strict';

/**
 * Module dependencies.
 */

const http = require('http');
const AuthenticationError = require('../errors/authenticationerror');

/**
 * Authenticates requests.
 *
 * Applies the `name`ed strategy (or strategies) to the incoming request, in
 * order to authenticate the request.  If authentication is successful, the user
 * will be logged in and populated at `req.user` and a session will be
 * established by default.  If authentication fails, an unauthorized response
 * will be sent.
 *
 * Options:
 *   - `session`          Save login state in session, defaults to _true_
 *   - `successRedirect`  After successful login, redirect to given URL
 *   - `successMessage`   True to store success message in
 *                        req.session.messages, or a string to use as override
 *                        message for success.
 *   - `successFlash`     True to flash success messages or a string to use as a flash
 *                        message for success (overrides any from the strategy itself).
 *   - `failureRedirect`  After failed login, redirect to given URL
 *   - `failureMessage`   True to store failure message in
 *                        req.session.messages, or a string to use as override
 *                        message for failure.
 *   - `failureFlash`     True to flash failure messages or a string to use as a flash
 *                        message for failures (overrides any from the strategy itself).
 *   - `assignProperty`   Assign the object provided by the verify callback to given property
 *
 * An optional `callback` can be supplied to allow the application to override
 * the default manner in which authentication attempts are handled.  The
 * callback has the following signature, where `user` will be set to the
 * authenticated user on a successful authentication attempt, or `false`
 * otherwise.  An optional `info` argument will be passed, containing additional
 * details provided by the strategy's verify callback - this could be information about
 * a successful authentication or a challenge message for a failed authentication.
 * An optional `status` argument will be passed when authentication fails - this could
 * be a HTTP response code for a remote authentication failure or similar.
 *
 *     app.get('/protected', function(req, res, next) {
 *       passport.authenticate('local', function(err, user, info, status) {
 *         if (err) { return next(err) }
 *         if (!user) { return res.redirect('/signin') }
 *         res.redirect('/account');
 *       })(req, res, next);
 *     });
 *
 * Note that if a callback is supplied, it becomes the application's
 * responsibility to log-in the user, establish a session, and otherwise perform
 * the desired operations.
 *
 * @example
 *
 *     passport.authenticate('local', { successRedirect: '/', failureRedirect: '/login' });
 *
 *     passport.authenticate('basic', { session: false });
 *
 *     passport.authenticate('twitter');
 *
 * @param {Authenticator} passport
 * @param {string|GenericArray} name
 * @param {PlainObject} options
 * @param {GenericCallback} callback
 * @returns {GenericCallback}
 * @public
 */
module.exports = function authenticate(passport, name, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};

  let multi = true;

  // Cast `name` to an array, allowing authentication to pass through a chain of
  // strategies.  The first strategy to succeed, redirect, or error will halt
  // the chain.  Authentication failures will proceed through each strategy in
  // series, ultimately failing if all strategies fail.
  //
  // This is typically used on API endpoints to allow clients to authenticate
  // using their preferred choice of Basic, Digest, token-based schemes, etc.
  // It is not feasible to construct a chain of multiple strategies that involve
  // redirection (for example both Facebook and Twitter), since the first one to
  // redirect will halt the chain.
  if (!Array.isArray(name)) {
    name = [name];
    multi = false;
  }

  return function authenticate(req, res, next) {
    // accumulator for failures from each strategy in the chain
    const failures = [];

    // eslint-disable-next-line jsdoc/require-jsdoc
    function redirect(url) {
      if (req.session && req.session.save && typeof req.session.save === 'function') {
        return req.session.save(() => res.redirect(url));
      }
      return res.redirect(url);
    }

    // eslint-disable-next-line consistent-return,  jsdoc/require-jsdoc
    function allFailed() {
      if (callback) {
        if (!multi) {
          return callback(null, false, failures[0].challenge, failures[0].status);
        }
        const challenges = failures.map(f => f.challenge);
        const statuses = failures.map(f => f.status);
        return callback(null, false, challenges, statuses);
      }

      // Strategies are ordered by priority.  For the purpose of flashing a
      // message, the first failure will be displayed.
      const failure = failures[0] || {};
      const challenge = failure.challenge || {};

      if (options.failureFlash) {
        let flash = options.failureFlash;
        if (typeof flash === 'string') {
          flash = { type: 'error', message: flash };
        }
        if (typeof flash !== 'boolean') {
          flash.type = flash.type || 'error';
        }

        const type = flash.type || challenge.type || 'error';
        const msg = flash.message || challenge.message || challenge;
        if (typeof msg === 'string') {
          req.flash(type, msg);
        }
      }
      if (options.failureMessage) {
        let msg = options.failureMessage;
        if (typeof msg === 'boolean') {
          msg = challenge.message || challenge;
        }
        if (typeof msg === 'string') {
          req.session.messages = req.session.messages || [];
          req.session.messages.push(msg);
        }
      }
      if (options.failureRedirect) {
        return redirect(options.failureRedirect);
      }

      // When failure handling is not delegated to the application, the default
      // is to respond with 401 Unauthorized.  Note that the WWW-Authenticate
      // header will be set according to the strategies in use (see
      // actions#fail).  If multiple strategies failed, each of their challenges
      // will be included in the response.
      const rchallenge = [];
      let rstatus;
      failures.forEach(({ challenge, status }) => {
        rstatus = rstatus || status;
        if (typeof challenge === 'string') {
          rchallenge.push(challenge);
        }
      });

      res.statusCode = rstatus || 401;
      if (res.statusCode === 401 && rchallenge.length) {
        res.setHeader('WWW-Authenticate', rchallenge);
      }
      if (options.failWithError) {
        return next(new AuthenticationError(http.STATUS_CODES[res.statusCode], rstatus));
      }
      res.end(http.STATUS_CODES[res.statusCode]);
    }

    // eslint-disable-next-line consistent-return
    (function attempt(i) {
      let strategy;
      const layer = name[i];
      // If no more strategies exist in the chain, authentication has failed.
      if (!layer) { return allFailed(); }

      // Get the strategy, which will be used as prototype from which to create
      // a new instance.  Action functions will then be bound to the strategy
      // within the context of the HTTP request/response pair.
      if (typeof layer.authenticate === 'function') {
        strategy = layer;
      } else {
        const prototype = passport._strategy(layer);
        if (!prototype) { return next(new Error(`Unknown authentication strategy "${layer}"`)); }

        strategy = Object.create(prototype);
      }

      // ----- BEGIN STRATEGY AUGMENTATION -----
      // Augment the new strategy instance with action functions.  These action
      // functions are bound via closure the the request/response pair.  The end
      // goal of the strategy is to invoke *one* of these action methods, in
      // order to indicate successful or failed authentication, redirect to a
      // third-party identity provider, etc.

      /**
       * Authenticate `user`, with optional `info`.
       *
       * Strategies should call this function to successfully authenticate a
       * user.  `user` should be an object supplied by the application after it
       * has been given an opportunity to verify credentials.  `info` is an
       * optional argument containing additional user information.  This is
       * useful for third-party authentication strategies to pass profile
       * details.
       *
       * @param {Object} user
       * @param {Object} info
       * @public
       */

      // eslint-disable-next-line consistent-return
      strategy.success = function success(user, info) {
        if (callback) {
          return callback(null, user, info);
        }

        info = info || {};
        let msg;

        if (options.successFlash) {
          let flash = options.successFlash;
          if (typeof flash === 'string') {
            flash = { type: 'success', message: flash };
          }
          if (typeof flash !== 'boolean') {
            flash.type = flash.type || 'success';
          }

          const type = flash.type || info.type || 'success';
          msg = flash.message || info.message || info;
          if (typeof msg === 'string') {
            req.flash(type, msg);
          }
        }
        if (options.successMessage) {
          msg = options.successMessage;
          if (typeof msg === 'boolean') {
            msg = info.message || info;
          }
          if (typeof msg === 'string') {
            req.session.messages = req.session.messages || [];
            req.session.messages.push(msg);
          }
        }
        if (options.assignProperty) {
          req[options.assignProperty] = user;
          return next();
        }

        // eslint-disable-next-line consistent-return
        req.logIn(user, options, (err) => {
          if (err) { return next(err); }

          // eslint-disable-next-line consistent-return, jsdoc/require-jsdoc
          function complete() {
            if (options.successReturnToOrRedirect) {
              let url = options.successReturnToOrRedirect;
              if (req.session && req.session.returnTo) {
                url = req.session.returnTo;
                delete req.session.returnTo;
              }
              return redirect(url);
            }
            if (options.successRedirect) {
              return redirect(options.successRedirect);
            }
            next();
          }

          if (options.authInfo !== false) {
            // eslint-disable-next-line consistent-return
            passport.transformAuthInfo(info, req, (err, tinfo) => {
              if (err) { return next(err); }
              req.authInfo = tinfo;
              complete();
            });
          } else {
            complete();
          }
        });
      };

      /**
       * Fail authentication, with optional `challenge` and `status`, defaulting
       * to 401.
       *
       * Strategies should call this function to fail an authentication attempt.
       *
       * @param {string} challenge
       * @param {number} status
       * @returns {void}
       * @public
       */
      strategy.fail = function fail(challenge, status) {
        if (typeof challenge === 'number') {
          status = challenge;
          challenge = undefined;
        }

        // push this failure into the accumulator and attempt authentication
        // using the next strategy
        failures.push({ challenge, status });
        attempt(i + 1);
      };

      /**
       * Redirect to `url` with optional `status`, defaulting to 302.
       *
       * Strategies should call this function to redirect the user (via their
       * user agent) to a third-party website for authentication.
       *
       * @param {string} url
       * @param {number} status
       * @returns {void}
       * @public
       */
      strategy.redirect = function redirect(url, status) {
        // NOTE: Do not use `res.redirect` from Express, because it can't decide
        //       what it wants.
        //
        //       Express 2.x: res.redirect(url, status)
        //       Express 3.x: res.redirect(status, url) -OR- res.redirect(url, status)
        //         - as of 3.14.0, deprecated warnings are issued if res.redirect(url, status)
        //           is used
        //       Express 4.x: res.redirect(status, url)
        //         - all versions (as of 4.8.7) continue to accept res.redirect(url, status)
        //           but issue deprecated versions

        res.statusCode = status || 302;
        res.setHeader('Location', url);
        res.setHeader('Content-Length', '0');
        res.end();
      };

      /**
       * Pass without making a success or fail decision.
       *
       * Under most circumstances, Strategies should not need to call this
       * function.  It exists primarily to allow previous authentication state
       * to be restored, for example from an HTTP session.
       *
       * @returns {void}
       * @public
       */
      strategy.pass = function pass() {
        next();
      };

      /**
       * Internal error while performing authentication.
       *
       * Strategies should call this function when an internal error occurs
       * during the process of performing authentication; for example, if the
       * user directory is not available.
       *
       * @param {Error} err
       * @public
       */

      // eslint-disable-next-line consistent-return
      strategy.error = function error(err) {
        if (callback) {
          return callback(err);
        }

        next(err);
      };

      // ----- END STRATEGY AUGMENTATION -----

      strategy.authenticate(req, options);
    }(0)); // attempt
  };
};
