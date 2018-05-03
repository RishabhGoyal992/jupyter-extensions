import $ from 'jquery';
import require from 'require';
import endpoints from './api_endpoints.json'

/**
 * CERNBox API connector
 * Converts API calls in callable functions and hides the complexities of getting and keeping track of a token
 */

function TokenError(message) {
    this.name = "TokenError";
    this.message = (message || "");
}

TokenError.prototype = Object.create(Error.prototype);

/**
 * Execute the funcions passed as parameters with the auth token stored
 * If the token is invalid, get a new one with an iFrame to bypass SSO
 */
var authtoken = {

    _token: -1,

    /**
     * Open auth page - through SSO - in a hidden iFrame and register event listener for iFrame page event, in order to store the token.
     * Then execute the function asked and pass the token.
     * @param func API function to call after getting token
     * @param config Configurations for the Api function call
     * @param success Function to call in case of API success
     * @param failure Function to call in case of API failure
     * @private
     */
    _get_auth_token: function (func, config, success, failure) {

        console.log('Getting CERNBox auth token');

        var frame = $("<iframe></iframe>");
        frame.hide();

        var that = this;
        /**
         * Listen for a call from inside the iFrame that passes the token as a parameter
         */
        window.addEventListener('message', function (event) {

            if (event.origin !== endpoints.domain) {
                failure(_, 'Your connection to CERN servers might have been compromised. Please contact Support');
            } else {
                that._token = event.data;
                func(that._token.authtoken, config, success, failure);
                frame.remove();
            }
        });

        frame.attr("src", endpoints.domain + endpoints.base + endpoints.authentication + '?Origin=' + window.location.protocol + "//" + window.location.hostname);
        $("body").append(frame);

    },

    /**
     * Check the validity of access token before executing the requested function.
     * In case of invalid token, refresh it.
     * Then call the requested function and pass the token
     * @param func API function to call after getting token
     * @param config Configurations for the Api function call
     * @param success Function to call in case of API success
     * @param failure Function to call in case of API failure
     */
    ready: function (func, config, success, failure) {

        if (this._token == -1 || new Date(this._token.expire) < new Date()) {
            this._get_auth_token(func, config, success, failure);
        } else {
            func(this._token.authtoken, config, success, failure);
        }
    },

    /**
     * Make the token invalid in order to request a new one
     */
    invalidate: function () {
        this._token = -1;
    },

    /**
     * Get the auth token string
     */
    get_auth_token_value: function () {
        return this._token.authtoken;
    }

}

/**
 * Get all projects shared by me
 * @param token Access token
 * @param success Function to call in case of API success
 * @param failure Function to call in case of API failure
 */
function get_shared_projects_by_me(token, _, success, failure) {

    ajax_request(endpoints.domain + endpoints.base + endpoints.shared,
        token, "GET", null, "json", success, failure);
}

/**
 * Get all projects shared with me by other users
 * @param token Access token
 * @param success Function to call in case of API success
 * @param failure Function to call in case of API failure
 */
function get_shared_projects_with_me(token, _, success, failure) {

    ajax_request(endpoints.domain + endpoints.base + endpoints.shared_with_me,
        token, "GET", null, "json", success, failure);
}

/**
 * Get information about a project shared by me
 * @param token Access token
 * @param config Project path
 * @param success Function to call in case of API success
 * @param failure Function to call in case of API failure
 */
function get_shared_project_info(token, config, success, failure) {

    ajax_request(endpoints.domain + endpoints.base + endpoints.share,
        token, "GET",
        {
            project: config
        },
        "json", success, failure);
}

/**
 * Share a project with other users
 * @param token Access token
 * @param config Object with a list share with the users with whom the project should be shared
 * @param success Function to call in case of API success
 * @param failure Function to call in case of API failure
 */
function set_shared_project(token, config, success, failure) {

    ajax_request(endpoints.domain + endpoints.base + endpoints.share + "?project=" + encodeURIComponent(config.project),
        token, "PUT",
        JSON.stringify({
            share_with: config.share
        }),
        null, success, failure);
}

/**
 * Stop sharing a project
 * @param token Access token
 * @param config Project path
 * @param success Function to call in case of API success
 * @param failure Function to call in case of API failure
 */
function remove_sharing_project(token, config, success, failure) {

    ajax_request(endpoints.domain + endpoints.base + endpoints.share + "?project=" + encodeURIComponent(config),
        token, "DELETE", null, null, success, failure);
}

/**
 * Clone a project to user path
 * @param token Access token
 * @param config Info about the project to be shared
 * @param success Function to call in case of API success
 * @param failure Function to call in case of API failure
 */
function clone_shared_project(token, config, success, failure) {

    ajax_request(endpoints.domain + endpoints.base + endpoints.clone
        + "?project=" + encodeURIComponent(config.project)
        + "&sharer=" + config.sharer
        + "&destination=" + encodeURIComponent(config.destination),
        token, "POST", null, null, success, failure);
}

/**
 * AJAX request wrapper
 * @param url URL to call
 * @param token Access token
 * @param type Type of request
 * @param data Data value to add to the request
 * @param success Function to call in case of API success
 * @param failure Function to call in case of API failure
 */
function ajax_request(url, token, type, data, dataType, success, failure) {

    $.ajax({
        url: require.toUrl(url),
        headers: {
            Authorization: 'Bearer ' + token
        },
        type: type,
        data: data,
        dataType: dataType,
        statusCode: {
            401: function () {
                throw new TokenError('Invalid token');
            }
        },
        success: success,
        error: failure
    });
}

/**
 * Wrapper to functions calls
 * In case of failure with the authentication, this invalidates the current token,
 * asks for a new one a re-calls the original function
 * @param func Function to be called
 * @returns {Function} Wrapping callable function
 */
function execute_function(func) {

    return function (config, success, failure) {
        try {
            authtoken.ready(func, config, success, failure);
        } catch (e) {
            if (e instanceof TokenError) { //Try a second time to get a valid token
                try {
                    authtoken.invalidate();
                    authtoken.ready(func, config, success, failure);
                } catch (e2) {
                    failure(_, e.message, e2);
                }
            } else {
                failure(_, e.message, e);
            }
        }

    }
}

export default {
    get_shared_projects_by_me: execute_function(get_shared_projects_by_me),
    get_shared_projects_with_me: execute_function(get_shared_projects_with_me),
    get_shared_project_info: execute_function(get_shared_project_info),
    set_shared_project: execute_function(set_shared_project),
    remove_sharing_project: execute_function(remove_sharing_project),
    clone_shared_project: execute_function(clone_shared_project),
    authtoken: authtoken
};