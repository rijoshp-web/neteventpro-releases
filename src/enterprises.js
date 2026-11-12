'use strict';
// IANA private enterprise numbers (1.3.6.1.4.1.N) of the makers whose gear is met on networks and in server rooms. One list for the whole app:
// the trap receiver (which vendor sent it), the MIB reader (which vendor a MIB file is for) and the Devices page.
const NAMES = {
  2: 'IBM', 9: 'Cisco', 11: 'HP / HPE', 23: 'Novell', 42: 'Sun / Oracle', 43: '3Com', 45: 'Nortel', 52: 'Cabletron', 63: 'Apple', 77: 'LAN Manager', 89: 'Allied Telesis', 94: 'Nokia',
  119: 'NEC', 171: 'D-Link', 207: 'Allied Telesis', 231: 'Siemens', 232: 'Compaq / HPE', 236: 'Samsung', 253: 'Xerox', 289: 'Brocade', 311: 'Microsoft', 318: 'APC (Schneider)', 343: 'Intel',
  476: 'Liebert / Vertiv', 534: 'Eaton', 674: 'Dell', 705: 'MGE UPS (Schneider)', 789: 'NetApp', 850: 'Lancom', 890: 'Zyxel', 1139: 'EMC', 1588: 'Brocade', 1872: 'Alteon',
  1916: 'Extreme Networks', 1981: 'EMC', 1991: 'Foundry / Brocade', 2011: 'Huawei', 2021: 'UCD / Net-SNMP', 2352: 'Redback', 2620: 'Check Point', 2636: 'Juniper', 3183: 'Intel (IPMI PET)',
  3375: 'F5', 3854: 'Cooper Bussmann', 3902: 'ZTE', 4413: 'Broadcom', 4526: 'Netgear', 4874: 'Juniper (Unisphere)', 4881: 'Ruijie', 5003: 'Avocent', 5624: 'Enterasys', 5951: 'Citrix NetScaler',
  6027: 'Force10 / Dell', 6486: 'Alcatel-Lucent', 6527: 'Nokia (Alcatel)', 6574: 'Synology', 6876: 'VMware', 8072: 'Net-SNMP', 8741: 'SonicWALL', 9148: 'Mellanox', 10418: 'Avaya',
  10704: 'Eaton (Powerware)', 11863: 'TP-Link', 12148: 'Eltek', 12356: 'Fortinet', 12532: 'Cyclades', 14179: 'Cisco Meraki', 14823: 'Aruba', 14988: 'MikroTik', 17163: 'Riverbed',
  18837: 'Spectracom', 19746: 'Vertiv / Liebert', 21239: 'Spectracom', 25461: 'Palo Alto Networks', 25506: 'H3C', 26543: 'Spectracom', 29671: 'Eltek', 30065: 'Arista', 35188: 'Eventide',
  41112: 'Ubiquiti', 52619: 'Eventide', 7777: 'Eventide'
};
/** display name of an enterprise number: the maker, or "Enterprise N" so that a sender is never shown without a vendor */
const nameOf = (n) => NAMES[n] || (n ? 'Enterprise ' + n : '');
/** the enterprise number an OID (array or dotted text) is under, or 0 */
function numberOf(oid) {
  const a = Array.isArray(oid) ? oid : String(oid || '').split('.').map(Number);
  return a.length >= 7 && a[0] === 1 && a[1] === 3 && a[2] === 6 && a[3] === 1 && a[4] === 4 && a[5] === 1 ? a[6] : 0;
}
module.exports = { NAMES, nameOf, numberOf };
