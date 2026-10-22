import json
import re
import unittest
from network_usage import PATTERN, FIELDS, build


class NetworkUsageTests(unittest.TestCase):
    def sample(self, **changes):
        item = dict(zip(FIELDS, [1, 'relayune-api', '0.3.23', 'network_usage',
            1789000000000, 1789000060000, 'http', 'GET', '/api/events', 'body', 0, 12345, 4, 0]))
        item.update(changes)
        return json.dumps(item, separators=(',', ':'))

    def test_exact_fields_and_numeric_types(self):
        match = re.fullmatch(PATTERN, self.sample())
        self.assertIsNotNone(match)
        self.assertEqual(len(match.groups()), len(FIELDS))
        self.assertEqual(build()['index']['keys']['tx_payload_bytes']['type'], 'long')

    def test_fail_closed(self):
        for changes in [{'email': 'secret'}, {'request_uri': '/api/responses/secret'},
                        {'request_uri': '/api/events?token=secret'}, {'tx_payload_bytes': -1},
                        {'tx_payload_bytes': 'secret'}, {'message_kind': 'secret'},
                        {'schema_version': 2}, {'event': 'http_request'}]:
            self.assertIsNone(re.fullmatch(PATTERN, self.sample(**changes)))
        self.assertIsNone(re.fullmatch(PATTERN, self.sample()[:-1]))

    def test_separate_store_and_source_removal(self):
        with self.assertRaises(ValueError):
            build(logstore='relayune')
        processors = build()['collection']['inputDetail']['plugin']['processors']
        self.assertFalse(processors[3]['detail']['KeepSourceIfParseError'])
        self.assertEqual(processors[-1]['detail']['Include'], FIELDS)
