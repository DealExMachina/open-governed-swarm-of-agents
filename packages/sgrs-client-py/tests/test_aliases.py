"""Verify public API surface: aliases, subclass relationships, and exported names."""

from __future__ import annotations

import unittest

from sgrs_client import (
    AdminClient,
    KernelAdminClient,
    KernelClient,
    SgrsClient,
    SgrsKernelClient,
    SwarmControlPlaneClient,
)


class TestClassHierarchy(unittest.TestCase):
    def test_kernel_client_is_subclass_of_sgrs_client(self) -> None:
        self.assertTrue(issubclass(KernelClient, SgrsClient))

    def test_kernel_admin_client_is_subclass_of_admin_client(self) -> None:
        self.assertTrue(issubclass(KernelAdminClient, AdminClient))

    def test_sgrs_client_is_not_subclass_of_admin_client(self) -> None:
        self.assertFalse(issubclass(SgrsClient, AdminClient))


class TestDeprecatedAliases(unittest.TestCase):
    def test_swarm_control_plane_client_is_sgrs_client(self) -> None:
        self.assertIs(SwarmControlPlaneClient, SgrsClient)

    def test_sgrs_kernel_client_is_kernel_client(self) -> None:
        self.assertIs(SgrsKernelClient, KernelClient)


class TestInstantiation(unittest.TestCase):
    def test_kernel_client_instantiates(self) -> None:
        c = KernelClient("http://host", "key")
        self.assertIsInstance(c, KernelClient)
        self.assertIsInstance(c, SgrsClient)
        c.close()

    def test_kernel_admin_client_instantiates(self) -> None:
        c = KernelAdminClient("http://host", "token")
        self.assertIsInstance(c, KernelAdminClient)
        self.assertIsInstance(c, AdminClient)
        c.close()

    def test_swarm_control_plane_client_instantiates(self) -> None:
        c = SwarmControlPlaneClient("http://host", "key")
        self.assertIsInstance(c, SgrsClient)
        c.close()

    def test_sgrs_kernel_client_instantiates(self) -> None:
        c = SgrsKernelClient("http://host", "key")
        self.assertIsInstance(c, KernelClient)
        self.assertIsInstance(c, SgrsClient)
        c.close()


if __name__ == "__main__":
    unittest.main()
