"""Relay contract checks; no sockets or hardware are used."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('sunseek_server', Path(__file__).resolve().parents[1] / 'server.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class RelayContract(unittest.TestCase):
    def test_camera_routes(self):
        for path in ('/status', '/images', '/stream', '/image?name=%2FIMG_001.JPG'):
            self.assertEqual(module.camera_url('192.168.4.1', path), 'http://192.168.4.1' + path)
        self.assertEqual(module.camera_url('sunseek.local', '/status'), 'http://sunseek.local/status')

    def test_invalid_destinations(self):
        for host, path in [('127.0.0.1', '/status'), ('8.8.8.8', '/status'), ('example.com', '/status'),
                           ('192.168.4.1', 'http://example.com/status'), ('192.168.4.1', '//example.com/status'),
                           ('192.168.4.1', '/api/command'), ('192.168.4.1', '/status\r\n'),
                           ('192.168.4.1', '/status#anything')]:
            with self.subTest(host=host, path=path), self.assertRaises(ValueError):
                module.camera_url(host, path)

    def test_redirects_do_not_leave_board(self):
        self.assertIsNone(module.NoRedirects().redirect_request(None, None, 302, '', {}, 'http://example.com'))

if __name__ == '__main__':
    unittest.main()
