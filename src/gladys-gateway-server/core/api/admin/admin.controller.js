module.exports = function(adminModel) {

  /**
   * @api {post} /admin/accounts/:id/resend Resend confirmation emails
   * @apiName Resend confirmation emails
   * @apiGroup Admin
   *
   * @apiSuccessExample {json} Success-Response:
   * HTTP/1.1 200 OK
   * 
   * {
   *   "status": 200
   * }
   */
  async function resendConfirmationEmail(req, res, next) {
    await adminModel.resendConfirmationEmail(req.params.id, req.body.language);
    return res.json({status: 200});
  }

  /**
   * @api {get} /admin/accounts Get all accounts
   * @apiName Get all accounts
   * @apiGroup Admin
   *
   * @apiSuccessExample {json} Success-Response:
   * HTTP/1.1 200 OK
   * 
   * [
   *  {
   *    "id": "071217d1-9c67-440a-acaa-185578c480ca",
   *    "user_count": 1
   *  }
   * ]
   */
  async function getAllAccounts(req, res, next) {
    let accounts = await adminModel.getAllAccounts();
    res.json(accounts);
  }

  return {
    resendConfirmationEmail,
    getAllAccounts
  };
};