const bodyParser = require('body-parser');
const asyncMiddleware = require('../middleware/asyncMiddleware.js');
const errorMiddleware = require('../middleware/errorMiddleware.js');
const { NotFoundError } = require('../common/error.js');

module.exports.load = function(app, controllers) {

  // parse application/x-www-form-urlencoded
  app.use(bodyParser.urlencoded({
    extended: false
  }));

  // parse application/json
  app.use(bodyParser.json());

  // CORS
  app.use(function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
    next();
  });

  app.options('/*', function(req, res, next) {
    res.send(200);
  });

  app.get('/ping', asyncMiddleware(controllers.pingController.ping));

  // user
  app.post('/users/signup', asyncMiddleware(controllers.userController.signup));
  app.post('/users/verify', asyncMiddleware(controllers.userController.confirmEmail));
  app.post('/users/login-salt', asyncMiddleware(controllers.userController.loginGetSalt));
  app.post('/users/login-generate-ephemeral', asyncMiddleware(controllers.userController.loginGenerateEphemeralValuePair));
  app.post('/users/login-finalize', asyncMiddleware(controllers.userController.loginDeriveSession));
  app.post('/users/login', asyncMiddleware(controllers.userController.login));

  // 404 error
  app.use(asyncMiddleware((req, res, next) => {
    throw new NotFoundError(`Route ${req.url} not found`);
  }));

  // error
  app.use(errorMiddleware);
};