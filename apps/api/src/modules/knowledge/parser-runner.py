"""Bound each Linux parser process independently of the API/Worker heap."""
import os, sys
if sys.platform.startswith('linux'):
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_FSIZE, (8 * 1024 * 1024, 8 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (25, 25))
os.execvpe(sys.argv[1], sys.argv[1:], os.environ)
