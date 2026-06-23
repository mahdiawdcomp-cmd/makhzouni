import {
  createBranch,
  getBranchById,
  listBranchSummaries,
  listBranches,
  updateBranch,
} from "../services/branch.service";
import { asyncHandler } from "../utils/async-handler";

export const getBranches = asyncHandler(async (req, res) => {
  const branches = await listBranches(
    req.validatedQuery as Parameters<typeof listBranches>[0]
  );

  res.json({
    success: true,
    data: branches,
  });
});

export const getBranchSummaries = asyncHandler(async (_req, res) => {
  const data = await listBranchSummaries();

  res.json({
    success: true,
    data,
  });
});

export const getBranchDetails = asyncHandler(async (req, res) => {
  const branch = await getBranchById(String(req.params.id));

  res.json({
    success: true,
    data: branch,
  });
});

export const addBranch = asyncHandler(async (req, res) => {
  const branch = await createBranch(req.body, req.user?.id);

  res.status(201).json({
    success: true,
    message: "Branch created successfully",
    data: branch,
  });
});

export const editBranch = asyncHandler(async (req, res) => {
  const branch = await updateBranch(String(req.params.id), req.body);

  res.json({
    success: true,
    message: "Branch updated successfully",
    data: branch,
  });
});
