const request = require('supertest');
const configTest = require('../../../tasks/config');

describe('GET /accounts/users', function() {
  it('should return all users in same account as me', function() {
    return request(TEST_BACKEND_APP)
      .get('/accounts/users')
      .set('Accept', 'application/json')
      .set('Authorization', configTest.jwtAccessTokenDashboard)
      .expect('Content-Type', /json/)
      .expect(200)
      .then(response => {
        response.body.should.be.instanceOf(Array);
        response.body.forEach((user) => {
          user.should.have.property('email');
          user.should.have.property('is_invitation');
        });
      });
  });
});

describe('POST /accounts/subscribe', function() {
  it('should subscribe to monthly plan and return next expiration', function() {
    return request(TEST_BACKEND_APP)
      .post('/accounts/subscribe')
      .send({
        stripe_source_id: 'stripe-source-id-sample'
      })
      .set('Accept', 'application/json')
      .set('Authorization', configTest.jwtAccessTokenDashboard)
      .expect('Content-Type', /json/)
      .expect(200)
      .then(response => {
        response.body.should.have.property('current_period_end');
      });
  });
});

describe('POST /accounts/users/:id/revoke', function() {
  it('should revoke a user', function() {
    return request(TEST_BACKEND_APP)
      .post('/accounts/users/3b69f1c5-d36c-419d-884c-50b9dd6e33e4/revoke')
      .set('Accept', 'application/json')
      .set('Authorization', configTest.jwtAccessTokenDashboard)
      .expect('Content-Type', /json/)
      .expect(200)
      .then(response => {
        response.body.should.have.property('success', true);
      });
  });
});