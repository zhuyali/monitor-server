'use strict';

const async = require('async');
const moment = require('moment');
const request = require('request');

const config = require('../config');
const platformModel = require('../models/paas/platform');
const pvModel = require('../models/saas/pageview');

const nginxModel = platformModel.nginx;
const nginxServer = config.nginxServer;

module.exports = function () {
  let date = moment().format('YYYYMMDD');
  async.whilst(
    function () { return true; },
    function (callback) {
      let result = {};
      request(config.statisticsServer, function (error, response, body) {
        if (body) {
          request(config.delStatisticsServer);
          let counter = 0;
          let records = body.split(/\n/);
          records.forEach((record, index) => {
            counter++;
            let temp = record.split(':');
            let domain = temp[0];
            let uriOrIp = temp[1];
            let param = temp[2];
            let val = temp[3];
            if (param !== 'page_view') {
              if (result[domain]) {
                if (result[domain][uriOrIp]) {
                  result[domain][uriOrIp][param] = val;
                } else {
                  result[domain][uriOrIp] = {};
                  result[domain][uriOrIp][param] = val;
                }
              } else {
                result[domain] = {};
                result[domain][uriOrIp] = {};
                result[domain][uriOrIp][param] = val;
              }
            } else {
              setTimeout(function () {
                let flag = false;
                let retry = 5;
                let tempIntervalId = setInterval(function () {
                  pvModel
                    .getByDateAndDomainAndIp(date, domain, uriOrIp)
                    .then(data => {
                      if (data.length) {
                        data.forEach((value, index) => {
                          let _id = data[index]._id;
                          let _pv = data[index].pv;
                          pvModel.updatePV(_id, _pv + parseInt(val))
                        });
                        clearInterval(tempIntervalId);
                      } else {
                        let province;
                        let provinces = pvModel.getProvinceByIp(uriOrIp);
                        if (provinces && provinces.length) {
                          province = provinces[0];
                          pvModel.add(date, domain, uriOrIp, val, province);
                          clearInterval(tempIntervalId);
                        } else if (retry <= 0) {
                          clearInterval(tempIntervalId);
                        } else {
                          retry--;
                          request(`http://ip.taobao.com/service/getIpInfo.php?ip=${uriOrIp}`, function (err, response, body) {
                            if (body && body) {
                              let result;
                              try {
                                result = JSON.parse(decodeURI(body));
                              } catch (e) {
                                result = {};
                              }
                              if (result.code === 0) {
                                flag = true;
                                clearInterval(tempIntervalId);
                                if (result.data.country_id === 'CN') {
                                  province = result.data.region;
                                  pvModel.add(date, domain, uriOrIp, val, province);
                                }
                              }
                            }
                          });
                        }
                      }
                    })
                }, 30 * 1000);
              }, counter * 110);
            }
          });
          Object.keys(result).forEach(domain => {
            Object.keys(result[domain]).forEach(uriOrIp => {
              nginxModel.add(domain, uriOrIp, result[domain][uriOrIp].request_count, result[domain][uriOrIp].request_time, result[domain][uriOrIp].average_request_time);
            })
          });
        }
      });
      setTimeout(function () {
        callback(null);
      }, 60 * 10 * 1000);
    }
  );
}