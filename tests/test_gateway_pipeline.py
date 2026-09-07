#!/usr/bin/env python3
"""
Test Suite & Live Technical Demo Harness for Edge Gateway Pipeline (Backend Directory)
"""

import os
import sys

# Add parent backend directory
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(CURRENT_DIR)
WORKSPACE_DIR = os.path.dirname(BACKEND_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)
if WORKSPACE_DIR not in sys.path:
    sys.path.insert(0, WORKSPACE_DIR)

from tests.test_gateway_pipeline import *

if __name__ == "__main__":
    if "--demo" in sys.argv or len(sys.argv) == 1:
        suite = unittest.TestLoader().loadTestsFromTestCase(TestEdgeGatewayPipeline)
        runner = unittest.TextTestRunner(verbosity=2)
        result = runner.run(suite)
        if result.wasSuccessful():
            print("\n")
            run_live_screen_demo()
        else:
            sys.exit(1)
    else:
        unittest.main()
